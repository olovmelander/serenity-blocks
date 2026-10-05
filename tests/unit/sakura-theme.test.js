import { readFileSync } from 'node:fs';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import SakuraTwilightTheme, { readSakuraEventCount } from '../../src/themes/sakura-twilight/sakura-twilight-theme.js';
import * as sakuraAssets from '../../src/themes/sakura-twilight/sakura-assets.js';
import { sakuraViewFor } from '../../src/themes/sakura-twilight/sakura-composition.js';
import { SakuraPost } from '../../src/themes/sakura-twilight/sakura-post.js';
import { SAKURA_TIERS } from '../../src/themes/sakura-twilight/sakura-quality.js';
import { SAKURA_REACTION_LIMITS, SakuraReactions } from '../../src/themes/sakura-twilight/sakura-reactions.js';
import { SAKURA_DEFAULT_BOARD } from '../../src/themes/sakura-twilight/sakura-stage.js';
import { SAKURA_TWILIGHT_TETROMINOS } from '../../src/themes/sakura-twilight/sakura-twilight-tetrominos.js';
import { SakuraWorld } from '../../src/themes/sakura-twilight/sakura-world.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { setGlobalRenderScale } from '../../src/themes/base-theme.js';
import { getThemeMeta } from '../../src/themes/theme-registry.js';

vi.mock('../../src/utils/viewport.js', () => ({
    getViewport: () => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }),
}));

const rendererState = vi.hoisted(() => ({ candidates: [], init: () => Promise.resolve() }));
const gpuSurfaces = vi.hoisted(() => ({ registered: [] }));

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
            this.shadowMap = { enabled: false };
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

vi.mock('../../src/utils/gpu-loss-coordinator.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        registerGpuSurface: vi.fn((label, surface) => {
            const entry = { label, surface, unregister: vi.fn() };
            gpuSurfaces.registered.push(entry);
            return entry.unregister;
        }),
    };
});

const GAMEPLAY_EVENTS = [EVENTS.HARD_DROP, EVENTS.PIECE_LOCK, EVENTS.LINE_CLEAR, EVENTS.COMBO, EVENTS.TSPIN, EVENTS.B2B,
    EVENTS.PERFECT_CLEAR, EVENTS.LEVEL_UP];
const DIRECTOR_METHODS = ['onHardDrop', 'onPieceLock', 'onLineClear', 'onCombo', 'onTSpin', 'onBackToBack',
    'onPerfectClear', 'onLevelUp', 'onGameOver'];
const FLOURISHES = ['onTSpin', 'onBackToBack', 'onPerfectClear', 'onLevelUp'];
const CONTAINER_ID = 'sakura-twilight-theme';
const assetDirectory = new URL('../../src/themes/sakura-twilight/assets/', import.meta.url);

let themes;
let container;
let rafs;
let liveRafs;

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function runFrame(index, timestamp) {
    liveRafs.delete(index + 1);
    rafs[index](timestamp);
}

function createTheme() {
    const theme = new SakuraTwilightTheme();
    themes.push(theme);
    vi.spyOn(theme, 'setupGpuResilience').mockImplementation(() => {});
    // No GLB is fetched in this suite: every start receives a stand-in bundle unless a test loads one.
    theme.loadAssets = vi.fn(async () => ({ stub: true }));
    return theme;
}

function stubSceneBuild(theme) {
    vi.spyOn(theme, 'buildScene').mockImplementation(() => {
        theme.scene = new THREE.Scene();
        theme.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 4000);
        theme.camera.position.set(0, 4.3, 16);
        theme.camera.lookAt(0, 4.9, -40);
        theme.world = {
            group: new THREE.Group(),
            update: vi.fn(),
            prepareCamera: vi.fn(),
            setBoard: vi.fn(),
            resetEffects: vi.fn(),
            dispose: vi.fn(),
        };
        theme.reactions = {
            onHardDrop: vi.fn(),
            onPieceLock: vi.fn(),
            onLineClear: vi.fn(),
            onCombo: vi.fn(),
            onTSpin: vi.fn(),
            onBackToBack: vi.fn(),
            onPerfectClear: vi.fn(),
            onLevelUp: vi.fn(),
            onGameOver: vi.fn(),
            update: vi.fn(),
            reset: vi.fn(),
            dispose: vi.fn(),
            getFrame: () => ({ pulse: 0.2 }),
        };
        theme.post = {
            update: vi.fn(), render: vi.fn(), setSize: vi.fn(), dispose: vi.fn(),
        };
        // As the real buildScene does: the first update of a new scene measures the board.
        theme.boardPoll = 0;
    });
}

/** A bundle shaped like the real one, whose every resource records its disposal. */
function stubAssets() {
    const part = () => ({ dispose: vi.fn() });
    const coat = { geometry: part(), material: { map: part(), dispose: vi.fn() } };
    return {
        blossoms: { variants: 2, meshes: { petal: part(), blossom_spray_0: part() } },
        props: { meshes: { torii: part(), stone_lantern: part() } },
        fuji: { geometry: part(), baseRadius: 2.5 },
        trees: { 'sakura-hero-weeping': { bark: part() }, 'sakura-grove-a': { bark: part() } },
        impostors: { tiles: [], texture: part() },
        fox: { scene: { traverse: (visit) => visit(coat) }, animations: [], coat },
    };
}

function assetDisposals(assets) {
    return [...Object.values(assets.blossoms.meshes), ...Object.values(assets.props.meshes),
        ...Object.values(assets.trees).map((tree) => tree.bark), assets.fuji.geometry, assets.impostors.texture,
        assets.fox.coat.geometry, assets.fox.coat.material, assets.fox.coat.material.map]
        .map((resource) => resource.dispose);
}

/** The real asset pack, parsed from disk by the theme's own loader; the sprite sheet is a stand-in. */
async function loadRealAssets() {
    // The fox carries a texture; in Node the loader needs somewhere to decode it to.
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 4, height: 4, close() {} }));
    const loader = {
        loadAsync: async (url) => {
            const file = decodeURIComponent(new URL(url).pathname.split('/').pop());
            const bytes = readFileSync(new URL(file, assetDirectory));
            const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            return new GLTFLoader().parseAsync(buffer, '');
        },
    };
    const textureLoader = { loadAsync: async () => new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4) };
    return sakuraAssets.loadSakuraAssets({ loader, textureLoader });
}

function realGeometries(assets) {
    const geometries = [...Object.values(assets.blossoms.meshes), ...Object.values(assets.props.meshes),
        ...Object.values(assets.trees).map((tree) => tree.bark), assets.fuji.geometry, assets.impostors.texture];
    assets.fox.scene.traverse((object) => { if (object.geometry) geometries.push(object.geometry); });
    return geometries;
}

function windowListener(type) {
    return window.addEventListener.mock.calls.findLast(([name]) => name === type)?.[1];
}

function boardCard({
    left, top, width, height,
}) {
    return {
        getBoundingClientRect: () => ({
            left, top, right: left + width, bottom: top + height, width, height,
        }),
    };
}

function showBoardCards(cards) {
    document.querySelectorAll = (selector) => (selector === '.player-card[data-player]' ? cards : [container]);
}

beforeEach(() => {
    themes = [];
    rafs = [];
    liveRafs = new Map();
    rendererState.candidates = [];
    rendererState.init = () => Promise.resolve();
    gpuSurfaces.registered = [];
    container = {
        id: CONTAINER_ID,
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
        getElementById: (id) => (id === CONTAINER_ID ? container : null),
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

describe('Sakura gameplay payloads', () => {
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
        ['3', ['lineCount', 'count', 'lines'], 1, 3],
        [-2.5, ['lineCount', 'count', 'lines'], 1, -3],
        [undefined, ['lineCount', 'count', 'lines'], 1, 1],
        [null, ['comboCount', 'combo', 'count'], 0, 0],
    ])('normalizes count %j', (payload, keys, fallback, expected) => {
        expect(readSakuraEventCount(payload, keys, fallback)).toBe(expected);
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

    it('routes hard drops and flourishes to the director once, unwrapped and in order', () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        theme.buildScene();
        theme.setupEventListeners();
        theme.setupEventListeners();
        const piece = { x: 3, y: 18, shape: [[1]] };
        const drop = {
            piece, startY: 2, endY: 18, distance: 16,
        };
        eventBus.emit(EVENTS.HARD_DROP, drop);
        eventBus.emit(EVENTS.PIECE_LOCK, { piece });
        eventBus.emit(EVENTS.TSPIN, { detail: { lineCount: 2 } });
        eventBus.emit(EVENTS.B2B, { active: true });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 3, perfectClearBonus: 800 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 4, source: 'odyssey' });
        const { reactions } = theme;
        // The drop's piece is pooled by the game: it is handed on by reference, synchronously.
        expect(reactions.onHardDrop).toHaveBeenCalledExactlyOnceWith(drop);
        expect(reactions.onHardDrop.mock.calls[0][0].piece).toBe(piece);
        expect(reactions.onPieceLock).toHaveBeenCalledExactlyOnceWith({ piece });
        expect(reactions.onHardDrop.mock.invocationCallOrder[0])
            .toBeLessThan(reactions.onPieceLock.mock.invocationCallOrder[0]);
        expect(reactions.onTSpin).toHaveBeenCalledExactlyOnceWith({ lineCount: 2 });
        expect(reactions.onBackToBack).toHaveBeenCalledExactlyOnceWith({ active: true });
        expect(reactions.onPerfectClear).toHaveBeenCalledExactlyOnceWith({ depth: 3, perfectClearBonus: 800 });
        expect(reactions.onLevelUp).toHaveBeenCalledExactlyOnceWith({ level: 4, source: 'odyssey' });
        for (const method of ['onLineClear', 'onCombo', 'onGameOver', 'reset']) {
            expect(reactions[method]).not.toHaveBeenCalled();
        }
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(1);
        theme.stop();
        for (const event of GAMEPLAY_EVENTS) {
            eventBus.emit(event, { lineCount: 2, comboCount: 4 });
            expect(eventBus.listenerCount(event)).toBe(0);
        }
        for (const method of FLOURISHES) expect(reactions[method]).toHaveBeenCalledOnce();
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
        theme.onHardDrop({ distance: 12 });
        for (const method of FLOURISHES) theme.onFlourish(method, { lineCount: 2 });
        for (const event of GAMEPLAY_EVENTS) eventBus.emit(event, { lineCount: 2, comboCount: 4, distance: 9 });
        for (const method of DIRECTOR_METHODS) expect(theme.reactions[method], method).not.toHaveBeenCalled();
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
        // The drop only ever strengthens the lock puff, so it obeys the same setting.
        theme.onHardDrop({ distance: 12 });
        eventBus.emit(EVENTS.HARD_DROP, { distance: 12 });
        expect(theme.reactions.onHardDrop).not.toHaveBeenCalled();
    });

    it.each([
        [false, false], ['false', false], ['off', false], ['0', false], ['no', false], [' OFF ', false],
        [true, true], ['true', true], ['on', true], [1, true], [undefined, true], [null, true], ['maybe', true],
    ])('reads the stored effect settings %j as enabled: %s', (stored, enabled) => {
        const theme = createTheme();
        theme.isActive = true;
        window.settings.backgroundComboEffects = stored;
        window.settings.pieceLockRipple = stored;
        stubSceneBuild(theme);
        theme.buildScene();
        theme.setupEventListeners();
        expect(theme.comboEffects).toBe(enabled);
        expect(theme.lockRipple).toBe(enabled);
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { x: 1 } });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2 });
        expect(theme.reactions.onPieceLock).toHaveBeenCalledTimes(enabled ? 1 : 0);
        expect(theme.reactions.onLineClear).toHaveBeenCalledTimes(enabled ? 1 : 0);
    });

    it('gates flourishes on the effects setting alone', () => {
        const theme = createTheme();
        theme.isActive = true;
        window.settings.pieceLockRipple = false;
        stubSceneBuild(theme);
        theme.buildScene();
        theme.setupEventListeners();
        eventBus.emit(EVENTS.TSPIN, { lineCount: 1 });
        eventBus.emit(EVENTS.B2B, { active: true });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        for (const method of FLOURISHES) expect(theme.reactions[method], method).toHaveBeenCalledOnce();
        expect(theme.reactions.onTSpin).toHaveBeenCalledWith({ lineCount: 1 });

        theme.comboEffects = false;
        theme.lockRipple = true;
        for (const event of [EVENTS.TSPIN, EVENTS.B2B, EVENTS.PERFECT_CLEAR, EVENTS.LEVEL_UP]) eventBus.emit(event, {});
        for (const method of FLOURISHES) expect(theme.reactions[method], method).toHaveBeenCalledOnce();
    });

    it('ignores a flourish the director does not have and survives having no director', () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        theme.buildScene();
        expect(() => theme.onFlourish('onConfetti', { level: 1 })).not.toThrow();
        expect(() => theme.onFlourish(undefined)).not.toThrow();
        for (const method of DIRECTOR_METHODS) expect(theme.reactions[method]).not.toHaveBeenCalled();
        theme.reactions = null;
        expect(() => {
            theme.onHardDrop({ distance: 3 });
            theme.onPieceLock({});
            theme.onLineClear(2);
            theme.onCombo(4);
            theme.onFlourish('onTSpin', {});
        }).not.toThrow();
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
        const clear = {
            lineCount: 200, viewportOrigin: { x: 0.2, y: 0.8 }, clearedRows: [20, 21, 22, 23], player: 2,
        };
        const combo = { comboCount: 100, position: { x: 0.75, y: 0.4 }, source: 'odyssey' };
        theme.onLineClear({ detail: clear });
        theme.onCombo(combo);
        expect(theme.reactions.onLineClear).toHaveBeenCalledExactlyOnceWith(4, clear);
        expect(theme.reactions.onCombo).toHaveBeenCalledExactlyOnceWith(32, combo);
        // A combo that has lapsed is passed on as none, for the director to ignore.
        theme.onCombo({ comboCount: -3 });
        expect(theme.reactions.onCombo).toHaveBeenLastCalledWith(0, { comboCount: -3 });
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
        // The envelopes and the petals already in flight go together: director and world.
        expect(theme.world.resetEffects).toHaveBeenCalledOnce();
        expect(theme.reactions.onPieceLock).not.toHaveBeenCalled();
        expect(theme.reactions.onLineClear).not.toHaveBeenCalled();
        expect(theme.reactions.onCombo).not.toHaveBeenCalled();
        eventBus.emit(EVENTS.HARD_DROP, { distance: 10 });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 2 });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 2 });
        expect(theme.reactions.onHardDrop).not.toHaveBeenCalled();
        expect(theme.reactions.onTSpin).not.toHaveBeenCalled();
        expect(theme.reactions.onPerfectClear).not.toHaveBeenCalled();

        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { backgroundComboEffects: true, pieceLockRipple: 'off' } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { x: 2 } });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 3 });
        expect(theme.reactions.onPieceLock).not.toHaveBeenCalled();
        expect(theme.reactions.onLineClear).toHaveBeenCalledExactlyOnceWith(2, { lineCount: 2 });
        expect(theme.reactions.onCombo).toHaveBeenCalledExactlyOnceWith(3, { comboCount: 3 });
        eventBus.emit(EVENTS.HARD_DROP, { distance: 10 });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 2 });
        expect(theme.reactions.onHardDrop).not.toHaveBeenCalled();
        expect(theme.reactions.onTSpin).toHaveBeenCalledExactlyOnceWith({ lineCount: 2 });
        // Turning effects back on, or touching another setting, clears nothing.
        expect(theme.reactions.reset).toHaveBeenCalledOnce();
        expect(theme.world.resetEffects).toHaveBeenCalledOnce();

        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'pieceLockRipple', value: true });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { x: 2 } });
        expect(theme.reactions.onPieceLock).toHaveBeenCalledExactlyOnceWith({ piece: { x: 2 } });
        eventBus.emit(EVENTS.HARD_DROP, { distance: 10 });
        expect(theme.reactions.onHardDrop).toHaveBeenCalledExactlyOnceWith({ distance: 10 });
    });

    it('clears director and world together when effects are switched off from the DOM event', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        windowListener('settingsChanged')({ detail: { settings: { backgroundComboEffects: false } } });
        expect(theme.comboEffects).toBe(false);
        expect(theme.reactions.reset).toHaveBeenCalledOnce();
        expect(theme.world.resetEffects).toHaveBeenCalledOnce();
        expect(theme.reactions.reset.mock.invocationCallOrder[0])
            .toBeLessThan(theme.world.resetEffects.mock.invocationCallOrder[0]);
        // A world without the hook (an older build) is tolerated.
        delete theme.world.resetEffects;
        theme.comboEffects = true;
        expect(() => windowListener('settingsChanged')({ type: 'backgroundComboEffects', value: false })).not.toThrow();
        expect(theme.comboEffects).toBe(false);
        expect(theme.reactions.reset).toHaveBeenCalledTimes(2);
    });

    it('ignores settings changes it is not running for, and payloads that say nothing', async () => {
        const theme = createTheme();
        stubSceneBuild(theme);
        theme.isActive = true;
        await theme.createScene();
        const { reactions } = theme;
        for (const payload of [undefined, null, 'effects', 7, {}, { detail: null }, { detail: {} },
            { changed: { musicVolume: 0.2 } }, { type: 'musicVolume', value: 0 }]) {
            expect(() => theme.handleSettingsChanged(payload)).not.toThrow();
        }
        expect(theme.comboEffects).toBe(true);
        expect(theme.lockRipple).toBe(true);
        expect(reactions.reset).not.toHaveBeenCalled();
        expect(theme.pendingQuality).toBeNull();
        // Stopped, it no longer listens to anything said about it.
        theme.stop();
        theme.handleSettingsChanged({ type: 'backgroundComboEffects', value: false });
        theme.handleSettingsChanged({ type: 'effectQuality', value: 'Low' });
        expect(theme.comboEffects).toBe(true);
        expect(theme.pendingQuality).toBeNull();
        expect(reactions.reset).toHaveBeenCalledOnce();
    });

    it('tells the director the game is over instead of wiping it', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const { reactions, world } = theme;
        const gameOver = windowListener('gameOver');
        expect(gameOver).toBeTypeOf('function');
        gameOver({ type: 'gameOver' });
        expect(reactions.onGameOver).toHaveBeenCalledOnce();
        expect(reactions.reset).not.toHaveBeenCalled();
        expect(world.resetEffects).not.toHaveBeenCalled();
        // The wind is let go even while reactions are switched off.
        theme.comboEffects = false;
        gameOver();
        expect(reactions.onGameOver).toHaveBeenCalledTimes(2);
        theme.stop();
        expect(window.removeEventListener).toHaveBeenCalledWith('gameOver', gameOver, undefined);
        expect(() => gameOver()).not.toThrow();
        expect(reactions.onGameOver).toHaveBeenCalledTimes(2);
    });
});

describe('Sakura theme identity and quality', () => {
    it('is the theme the registry lists under its name, with the same resource profile and container', () => {
        const theme = createTheme();
        const meta = getThemeMeta(theme.name);
        expect(meta, `registry entry for "${theme.name}"`).toBeDefined();
        expect(meta.id).toBe(theme.name);
        // The manager budgets GPU memory by the registry's profile: the class must agree with it.
        expect(theme.resourceProfile).toBe(meta.resourceProfile);
        expect(meta.module.endsWith('/sakura-twilight-theme.js')).toBe(true);
        // The canvas goes into the container the registry creates for that id.
        expect(CONTAINER_ID).toBe(`${meta.id}-theme`);
        expect(theme.getTetrominoConfig()).toBe(SAKURA_TWILIGHT_TETROMINOS);
        expect(Object.keys(theme.getTetrominoConfig().colors))
            .toEqual(expect.arrayContaining(['I', 'O', 'T', 'S', 'Z', 'J', 'L']));
        // Nothing exists before a start: no roots to warm, no MRT pass to ask for.
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(theme.usesMrtScenePass()).toBe(false);
        for (const key of ['renderer', 'scene', 'camera', 'world', 'reactions', 'post', 'assets', 'timer']) {
            expect(theme[key], key).toBeNull();
        }
        expect(() => {
            theme.update(0.016);
            theme.renderFrame();
            theme.resize(800, 600);
            theme.disposeRuntime();
        }).not.toThrow();
        expect(theme.resume()).toBe(false);
    });

    it('reads its tier from the settings, the canonical key first, and knows every tier', () => {
        const theme = createTheme();
        expect(theme.getCurrentQualityLevel()).toBe('High');
        window.settings.graphicsQuality = 'low';
        expect(theme.getCurrentQualityLevel()).toBe('Low');
        window.settings.effectQuality = 'ULTRA';
        expect(theme.getCurrentQualityLevel()).toBe('Ultra');
        window.settings.effectQuality = 'potato';
        expect(theme.getCurrentQualityLevel()).toBe('High');
        const tiers = Object.keys(SAKURA_TIERS).sort();
        expect(Object.keys(SAKURA_REACTION_LIMITS).sort()).toEqual(tiers);
        for (const quality of tiers) {
            theme.applyQualityPreset(quality.toLowerCase());
            expect(theme.quality).toBe(quality);
        }
        theme.applyQualityPreset('nonsense');
        expect(theme.quality).toBe('High');
    });

    it.each(Object.keys(SAKURA_TIERS))('builds the garden at the %s tier the settings ask for', async (quality) => {
        window.settings.effectQuality = quality;
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        let built;
        const buildScene = theme.buildScene.getMockImplementation();
        theme.buildScene.mockImplementation(() => {
            built = theme.quality;
            buildScene();
        });
        await theme.createScene();
        expect(built).toBe(quality);
        // Cheaper tiers also draw fewer pixels: the cap never rises as the tier drops.
        const [[ratio]] = theme.renderer.setPixelRatio.mock.calls;
        expect(ratio).toBeGreaterThan(0);
        expect(ratio).toBeLessThanOrEqual(1);
        expect(theme.renderer.setSize).toHaveBeenCalledExactlyOnceWith(1440, 900);
    });

    it('caps the pixel ratio lower on cheaper tiers', async () => {
        window.devicePixelRatio = 3;
        const ratios = {};
        const order = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
        const measure = async (quality) => {
            window.settings.effectQuality = quality;
            const theme = createTheme();
            theme.isActive = true;
            stubSceneBuild(theme);
            await theme.createScene();
            [[ratios[quality]]] = theme.renderer.setPixelRatio.mock.calls;
            theme.stop();
        };
        // One start at a time: each reads the setting of the moment.
        await order.reduce((previous, quality) => previous.then(() => measure(quality)), Promise.resolve());
        for (let index = 1; index < order.length; index += 1) {
            expect(ratios[order[index]], order[index]).toBeLessThanOrEqual(ratios[order[index - 1]]);
        }
        expect(ratios.Minimal).toBeLessThan(ratios.Extreme);
        // Never the display's full density on a dense screen.
        expect(ratios.Extreme).toBeLessThan(3);
        expect(ratios.Minimal).toBeGreaterThan(0.4);
    });
});

describe('Sakura renderer ownership', () => {
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
        // A start that never owned a renderer never asks for the assets either.
        expect(theme.loadAssets).not.toHaveBeenCalled();
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
        // The garden is lit through a shadow map on whichever backend it ends up with.
        expect(theme.renderer).toBe(rendererState.candidates[1]);
        expect(theme.renderer.shadowMap.enabled).toBe(true);
        expect(theme.loadAssets).toHaveBeenCalledOnce();
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[Sakura]'), expect.any(Error));
    });

    it('fails the start when neither backend initializes, naming the theme and keeping the cause', async () => {
        window.location.search = '';
        rendererState.init = (renderer) => Promise.reject(
            new Error(renderer.options.forceWebGL ? 'no webgl2' : 'no webgpu'),
        );
        const theme = createTheme();
        theme.isActive = true;
        const build = vi.spyOn(theme, 'buildScene');
        const failure = await theme.createScene().catch((error) => error);
        expect(failure).toBeInstanceOf(Error);
        expect(failure.message).toBe('Sakura Twilight could not initialize WebGPU or WebGL2.');
        expect(failure.cause.message).toBe('no webgl2');
        expect(rendererState.candidates).toHaveLength(2);
        rendererState.candidates.forEach((renderer) => expect(renderer.dispose).toHaveBeenCalledOnce());
        expect(build).not.toHaveBeenCalled();
        expect(theme.loadAssets).not.toHaveBeenCalled();
        expect(container.children).toHaveLength(0);
        expect(theme.renderer).toBeNull();
    });

    it.each([
        ['?forceWebGL'], ['?forceWebGL=1'], ['?forceWebGL=true'], ['?sakuraForceWebGL=on'], ['?x=1&sakuraForceWebGL'],
    ])('honors the %s URL flag without attempting native initialization', async (search) => {
        window.location.search = search;
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(rendererState.candidates).toHaveLength(1);
        expect(rendererState.candidates[0].options.forceWebGL).toBe(true);
        expect(rendererState.candidates[0].init).toHaveBeenCalledOnce();
        expect(theme.isWebGPU).toBe(false);
    });

    it.each([
        ['?forceWebGL=0'], ['?forceWebGL=false'], ['?other=1'], [''],
    ])('goes native first for %j', async (search) => {
        window.location.search = search;
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(rendererState.candidates).toHaveLength(1);
        expect(rendererState.candidates[0].options.forceWebGL).toBe(false);
        expect(theme.isWebGPU).toBe(true);
    });

    it('skips the native attempt where the browser has no WebGPU at all', async () => {
        window.location.search = '';
        vi.stubGlobal('navigator', {});
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(rendererState.candidates.map((renderer) => renderer.options.forceWebGL)).toEqual([true]);
        expect(theme.usesNodeMaterials).toBe(true);
    });

    it('enables shadows on the native renderer before any artwork exists', async () => {
        window.location.search = '';
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        let shadowsAtBuild;
        const buildScene = theme.buildScene.getMockImplementation();
        theme.buildScene.mockImplementation(() => {
            shadowsAtBuild = theme.renderer.shadowMap.enabled;
            buildScene();
        });
        await theme.createScene();
        expect(rendererState.candidates).toHaveLength(1);
        expect(theme.isWebGPU).toBe(true);
        expect(shadowsAtBuild).toBe(true);
        expect(theme.renderer.shadowMap.enabled).toBe(true);
        // The canvas sits under the board and never takes a click or a screen reader's attention.
        const canvas = theme.renderer.domElement;
        expect(canvas.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
        expect(canvas.style.cssText).toContain('pointer-events:none');
        expect(theme.renderer.options).toMatchObject({ alpha: false, powerPreference: 'high-performance' });
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

    it('says so when its container is missing', async () => {
        document.getElementById = () => null;
        const theme = createTheme();
        theme.isActive = true;
        await expect(theme.createScene()).rejects.toThrow('[Sakura] Theme container not found.');
        expect(rendererState.candidates).toHaveLength(0);
        expect(theme.loadAssets).not.toHaveBeenCalled();
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
        // Only the start that kept its renderer went on to load the assets.
        expect(theme.loadAssets).toHaveBeenCalledOnce();
    });

    it('releases every owned resource and subscription once through repeated stop and cleanup', async () => {
        window.location.search = '?forceWebGL=1&themeValidation=1';
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        const bundle = stubAssets();
        theme.loadAssets.mockResolvedValue(bundle);
        await theme.createScene();
        const {
            renderer, world, post, reactions, timer,
        } = theme;
        const timerDispose = vi.spyOn(timer, 'dispose');
        expect(window.__SAKURA__).toBe(theme);
        expect(theme.getWarmupRoots()).toEqual([world.group]);
        expect(theme.usesMrtScenePass()).toBe(false);
        expect(theme.assets).toBe(bundle);
        theme.stop();
        theme.stop();
        theme.cleanup();
        theme.cleanup();
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(world.dispose).toHaveBeenCalledOnce();
        expect(post.dispose).toHaveBeenCalledOnce();
        expect(reactions.dispose).toHaveBeenCalledOnce();
        expect(timerDispose).toHaveBeenCalledOnce();
        assetDisposals(bundle).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
        expect(container.children).toEqual([]);
        expect(liveRafs.size).toBe(0);
        expect(theme.animationIds).toEqual([]);
        expect(theme.eventUnsubscribers).toEqual([]);
        expect(theme._eventListeners).toEqual([]);
        for (const key of ['renderer', 'world', 'post', 'reactions', 'assets', 'timer', 'scene', 'camera']) {
            expect(theme[key]).toBeNull();
        }
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(window.__SAKURA__).toBeUndefined();
        eventBus.emit(EVENTS.COMBO, { comboCount: 8 });
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 390, height: 844 });
        for (const event of GAMEPLAY_EVENTS) eventBus.emit(event, { lineCount: 2 });
        for (const method of DIRECTOR_METHODS) expect(reactions[method]).not.toHaveBeenCalled();
    });

    it('only publishes itself for inspection when theme validation asks for it', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(window.__SAKURA__).toBeUndefined();
        // Another theme's handle is not this one's to remove.
        const other = { name: 'someone else' };
        window.__SAKURA__ = other;
        theme.stop();
        expect(window.__SAKURA__).toBe(other);
    });

    it('keeps going when one part fails to dispose', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        const bundle = stubAssets();
        theme.loadAssets.mockResolvedValue(bundle);
        await theme.createScene();
        const {
            renderer, world, post, reactions,
        } = theme;
        post.dispose.mockImplementation(() => { throw new Error('post is stuck'); });
        world.dispose.mockImplementation(() => { throw new Error('world is stuck'); });
        expect(() => theme.stop()).not.toThrow();
        expect(console.warn).toHaveBeenCalledWith('[Sakura] Post disposal failed.', expect.any(Error));
        expect(console.warn).toHaveBeenCalledWith('[Sakura] World disposal failed.', expect.any(Error));
        // Everything after the failures was still released.
        assetDisposals(bundle).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
        expect(reactions.dispose).toHaveBeenCalledOnce();
        expect(renderer.dispose).toHaveBeenCalledOnce();
        for (const key of ['renderer', 'world', 'post', 'reactions', 'assets', 'timer', 'scene', 'camera']) {
            expect(theme[key], key).toBeNull();
        }
        expect(container.children).toHaveLength(0);
    });
});

describe('Sakura GPU loss recovery', () => {
    function resilientTheme() {
        const theme = createTheme();
        theme.setupGpuResilience.mockRestore();
        const monitor = vi.spyOn(theme, 'setupRendererResilience').mockImplementation(() => {});
        return { theme, monitor };
    }

    it('registers no recovery surface on the WebGL2 backend, which recovers its own context', async () => {
        const { theme, monitor } = resilientTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(theme.isWebGPU).toBe(false);
        expect(monitor).toHaveBeenCalledExactlyOnceWith(theme.renderer, { webgpuDevice: null });
        expect(gpuSurfaces.registered).toEqual([]);
        expect(() => theme.stop()).not.toThrow();
    });

    it('recovers a lost WebGPU device once, by restarting on WebGL2', async () => {
        window.location.search = '';
        const { theme, monitor } = resilientTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        const shared = { loadTheme: vi.fn() };
        const managers = { assetManager: { id: 'assets' }, audioManager: { id: 'audio' }, onRuntimeFailure: vi.fn() };
        Object.assign(theme, { webglRenderer: shared, ...managers });
        await theme.createScene();
        expect(theme.isWebGPU).toBe(true);
        expect(monitor).toHaveBeenCalledOnce();
        expect(monitor.mock.calls[0][0]).toBe(theme.renderer);
        expect(gpuSurfaces.registered).toHaveLength(1);
        const [{ label, surface, unregister }] = gpuSurfaces.registered;
        expect(label).toBe('sakura-twilight');
        expect(theme.forceWebGL).toBe(false);

        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        await surface.recover();
        expect(theme.forceWebGL).toBe(true);
        expect(start).toHaveBeenCalledExactlyOnceWith(shared, managers);
        // A second loss is not answered with a second restart.
        await expect(surface.recover()).rejects.toThrow('Sakura Twilight WebGPU recovery already attempted.');
        expect(start).toHaveBeenCalledOnce();
        // The registration ends with the runtime.
        expect(unregister).not.toHaveBeenCalled();
        theme.stop();
        expect(unregister).toHaveBeenCalledOnce();
        theme.stop();
        expect(unregister).toHaveBeenCalledOnce();
    });

    it('remembers the fallback: the next scene goes straight to WebGL2', async () => {
        window.location.search = '';
        const { theme } = resilientTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const [{ surface, unregister }] = gpuSurfaces.registered;
        vi.spyOn(theme, 'start').mockResolvedValue();
        await surface.recover();
        await theme.createScene(theme.lifecycleGeneration);
        expect(rendererState.candidates.map((renderer) => renderer.options.forceWebGL)).toEqual([false, true]);
        expect(theme.isWebGPU).toBe(false);
        // The old surface was dropped with the old runtime and none replaced it.
        expect(unregister).toHaveBeenCalledOnce();
        expect(gpuSurfaces.registered).toHaveLength(1);
    });

    it('only marks the fallback when the device is lost while the theme is not showing', async () => {
        window.location.search = '';
        const { theme } = resilientTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const [{ surface }] = gpuSurfaces.registered;
        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        theme.isActive = false;
        await surface.recover();
        expect(theme.forceWebGL).toBe(true);
        expect(start).not.toHaveBeenCalled();
    });
});

describe('Sakura asset loading', () => {
    it('loads the assets once per start, after the renderer is up and before any artwork is built', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        const bundle = stubAssets();
        const during = {};
        theme.loadAssets.mockImplementation(async (isCurrent) => {
            Object.assign(during, {
                renderer: theme.renderer,
                canvases: container.children.length,
                shadows: theme.renderer?.shadowMap.enabled,
                world: theme.world,
                assets: theme.assets,
                current: isCurrent(),
                listeners: eventBus.listenerCount(EVENTS.LINE_CLEAR),
                frames: rafs.length,
            });
            return bundle;
        });
        await theme.createScene();
        expect(theme.loadAssets).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
        expect(during).toEqual({
            renderer: rendererState.candidates[0],
            canvases: 1,
            shadows: true,
            world: null,
            assets: null,
            current: true,
            listeners: 0,
            frames: 0,
        });
        expect(theme.buildScene).toHaveBeenCalledOnce();
        expect(rendererState.candidates[0].init.mock.invocationCallOrder[0])
            .toBeLessThan(theme.loadAssets.mock.invocationCallOrder[0]);
        expect(theme.loadAssets.mock.invocationCallOrder[0]).toBeLessThan(theme.buildScene.mock.invocationCallOrder[0]);
        expect(theme.assets).toBe(bundle);
        assetDisposals(bundle).forEach((dispose) => expect(dispose).not.toHaveBeenCalled());
        expect(liveRafs.size).toBe(1);

        // The predicate it handed to the loader follows the life of that start.
        const [[isCurrent]] = theme.loadAssets.mock.calls;
        expect(isCurrent()).toBe(true);
        theme.stop();
        expect(isCurrent()).toBe(false);
        expect(theme.assets).toBeNull();
        assetDisposals(bundle).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());

        // Nothing is cached between starts: the next one loads, and later releases, its own bundle.
        const next = stubAssets();
        theme.loadAssets.mockImplementation(async () => next);
        theme.isActive = true;
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.loadAssets).toHaveBeenCalledTimes(2);
        expect(theme.assets).toBe(next);
        expect(isCurrent()).toBe(false);
        expect(theme.loadAssets.mock.calls[1][0]()).toBe(true);
        assetDisposals(bundle).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
        assetDisposals(next).forEach((dispose) => expect(dispose).not.toHaveBeenCalled());
    });

    it.each([
        'stop', 'cleanup', 'releaseManagedGpuResources', 'disposeRuntime',
    ])('releases the bundle with the runtime when it ends through %s()', async (end) => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        const bundle = stubAssets();
        theme.loadAssets.mockResolvedValue(bundle);
        await theme.createScene();
        const { world, post } = theme;
        theme[end]();
        theme[end]();
        expect(theme.assets).toBeNull();
        assetDisposals(bundle).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
        // The lens reads the garden and the garden borrows the bundle's geometry: they let go in that order.
        expect(post.dispose.mock.invocationCallOrder[0]).toBeLessThan(world.dispose.mock.invocationCallOrder[0]);
        expect(world.dispose.mock.invocationCallOrder[0])
            .toBeLessThan(bundle.trees['sakura-hero-weeping'].bark.dispose.mock.invocationCallOrder[0]);
        expect(world.dispose.mock.invocationCallOrder[0])
            .toBeLessThan(bundle.fox.coat.geometry.dispose.mock.invocationCallOrder[0]);
    });

    it('builds nothing and keeps nothing when the theme stops while its assets load', async () => {
        const pending = deferred();
        const theme = createTheme();
        theme.isActive = true;
        theme.loadAssets.mockReturnValue(pending.promise);
        const build = vi.spyOn(theme, 'buildScene');
        const start = theme.createScene();
        await vi.waitFor(() => expect(theme.loadAssets).toHaveBeenCalledOnce());
        const [renderer] = rendererState.candidates;
        // The renderer is already published while the pack arrives.
        expect(theme.renderer).toBe(renderer);
        expect(container.children).toEqual([renderer.domElement]);
        theme.stop();
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(container.children).toHaveLength(0);
        const bundle = stubAssets();
        pending.resolve(bundle);
        await start;
        expect(build).not.toHaveBeenCalled();
        for (const key of ['assets', 'world', 'post', 'reactions', 'renderer', 'scene', 'camera', 'timer']) {
            expect(theme[key], key).toBeNull();
        }
        assetDisposals(bundle).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(rafs).toHaveLength(0);
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(0);
    });

    it.each([
        ['after a stop', true], ['called straight over the first', false],
    ])('does not let a late bundle replace or dispose a newer runtime started %s', async (_label, stopFirst) => {
        const pending = deferred();
        const late = stubAssets();
        const fresh = stubAssets();
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        theme.loadAssets.mockImplementationOnce(() => pending.promise).mockImplementation(async () => fresh);
        const first = theme.createScene(theme.lifecycleGeneration);
        await vi.waitFor(() => expect(theme.loadAssets).toHaveBeenCalledOnce());
        if (stopFirst) {
            theme.stop();
            theme.isActive = true;
        }
        await theme.createScene(theme.lifecycleGeneration);
        const { renderer, world } = theme;
        expect(theme.assets).toBe(fresh);
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
        pending.resolve(late);
        await first;
        expect(theme.assets).toBe(fresh);
        expect(theme.renderer).toBe(renderer);
        expect(theme.world).toBe(world);
        expect(renderer).toBe(rendererState.candidates[1]);
        expect(renderer.dispose).not.toHaveBeenCalled();
        expect(world.dispose).not.toHaveBeenCalled();
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
        assetDisposals(late).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
        assetDisposals(fresh).forEach((dispose) => expect(dispose).not.toHaveBeenCalled());
        expect(theme.buildScene).toHaveBeenCalledOnce();
        expect(container.children).toEqual([renderer.domElement]);
        expect(liveRafs.size).toBe(1);
        expect(eventBus.listenerCount(EVENTS.LINE_CLEAR)).toBe(1);
    });

    it('keeps nothing when the loader hands back no bundle', async () => {
        const theme = createTheme();
        theme.isActive = true;
        theme.loadAssets.mockResolvedValue(null);
        const build = vi.spyOn(theme, 'buildScene');
        await expect(theme.createScene()).resolves.toBeUndefined();
        expect(build).not.toHaveBeenCalled();
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
        expect(container.children).toHaveLength(0);
        expect(theme.renderer).toBeNull();
        expect(theme.assets).toBeNull();
        expect(rafs).toHaveLength(0);
    });

    it('rejects the start when the assets fail to load and leaves no renderer or world behind', async () => {
        const theme = createTheme();
        theme.isActive = true;
        const build = vi.spyOn(theme, 'buildScene');
        theme.loadAssets.mockRejectedValue(new Error('404 sakura-hero-weeping.glb'));
        await expect(theme.createScene()).rejects.toThrow('404 sakura-hero-weeping.glb');
        const [renderer] = rendererState.candidates;
        expect(build).not.toHaveBeenCalled();
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(container.children).toHaveLength(0);
        for (const key of ['renderer', 'world', 'post', 'reactions', 'assets', 'scene', 'camera', 'timer']) {
            expect(theme[key], key).toBeNull();
        }
        expect(rafs).toHaveLength(0);
        expect(theme.eventUnsubscribers).toEqual([]);
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(0);
    });

    it('releases the bundle and the renderer when the garden itself fails to build', async () => {
        const theme = createTheme();
        theme.isActive = true;
        const bundle = stubAssets();
        theme.loadAssets.mockResolvedValue(bundle);
        const half = { dispose: vi.fn(), group: new THREE.Group() };
        vi.spyOn(theme, 'buildScene').mockImplementation(() => {
            theme.scene = new THREE.Scene();
            theme.world = half;
            throw new Error('[Sakura] The blossom pack has no "petal" mesh.');
        });
        await expect(theme.createScene()).rejects.toThrow('has no "petal" mesh');
        const [renderer] = rendererState.candidates;
        // What was half-built is disposed, then the bundle it borrowed from, then the renderer.
        expect(half.dispose).toHaveBeenCalledOnce();
        assetDisposals(bundle).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(container.children).toHaveLength(0);
        for (const key of ['renderer', 'world', 'post', 'reactions', 'assets', 'scene', 'camera', 'timer']) {
            expect(theme[key], key).toBeNull();
        }
        expect(rafs).toHaveLength(0);
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(0);
    });

    it('fails start() on an asset error, stays restartable and starts cleanly the second time', async () => {
        const theme = createTheme();
        stubSceneBuild(theme);
        const shared = { loadTheme: vi.fn() };
        const bundle = stubAssets();
        theme.loadAssets.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(bundle);
        await expect(theme.start(shared, {})).rejects.toThrow('offline');
        expect(theme.lifecycleState).toBe('failed');
        expect(theme.isActive).toBe(false);
        expect(theme.renderer).toBeNull();
        expect(theme.world).toBeNull();
        expect(theme.buildScene).not.toHaveBeenCalled();
        expect(container.children).toHaveLength(0);
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
        expect(liveRafs.size).toBe(0);

        await theme.start(shared, {});
        expect(theme.lifecycleState).toBe('running');
        expect(theme.loadAssets).toHaveBeenCalledTimes(2);
        expect(theme.assets).toBe(bundle);
        expect(theme.world).not.toBeNull();
        expect(theme.renderer).toBe(rendererState.candidates[1]);
        expect(container.children).toEqual([theme.renderer.domElement]);
        expect(liveRafs.size).toBe(1);
        theme.cleanup();
        assetDisposals(bundle).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
    });

    it('does not let a stale failed load tear down a newer runtime', async () => {
        const pending = deferred();
        const fresh = stubAssets();
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        theme.loadAssets.mockImplementationOnce(() => pending.promise).mockImplementation(async () => fresh);
        const first = theme.createScene(theme.lifecycleGeneration).catch((error) => error);
        await vi.waitFor(() => expect(theme.loadAssets).toHaveBeenCalledOnce());
        theme.stop();
        theme.isActive = true;
        await theme.createScene(theme.lifecycleGeneration);
        const { renderer, world } = theme;
        pending.reject(new Error('late 404'));
        // The stale start still reports its own failure to whoever awaited it.
        expect((await first).message).toBe('late 404');
        expect(theme.renderer).toBe(renderer);
        expect(theme.world).toBe(world);
        expect(theme.assets).toBe(fresh);
        expect(renderer.dispose).not.toHaveBeenCalled();
        expect(world.dispose).not.toHaveBeenCalled();
        assetDisposals(fresh).forEach((dispose) => expect(dispose).not.toHaveBeenCalled());
        expect(liveRafs.size).toBe(1);
    });

    // The asset pack is awaited after the renderer initialises and before listeners attach, so the
    // settings are reconciled a second time once it has loaded: a quality change made during the
    // load decides the tier the garden is built at.
    it('ends up at the latest tier when quality changes while the assets load', async () => {
        const pending = deferred();
        window.settings.effectQuality = 'Low';
        const theme = createTheme();
        theme.isActive = true;
        theme.loadAssets.mockReturnValue(pending.promise);
        stubSceneBuild(theme);
        const start = theme.createScene();
        await vi.waitFor(() => expect(theme.loadAssets).toHaveBeenCalledOnce());
        expect(theme.quality).toBe('Low');
        window.settings.effectQuality = 'High';
        // No runtime listener can observe this dispatch until the scene has been built.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'effectQuality', value: 'High' });
        pending.resolve(stubAssets());
        await start;
        await Promise.resolve();
        // Building High outright, or building Low and queueing the rebuild, would both be fine.
        expect(theme.pendingQuality ?? theme.quality).toBe('High');
    });

    it('delegates loading to the asset module with the ownership predicate it was given', async () => {
        const bundle = stubAssets();
        const load = vi.spyOn(sakuraAssets, 'loadSakuraAssets').mockResolvedValue(bundle);
        const theme = new SakuraTwilightTheme();
        themes.push(theme);
        const isCurrent = vi.fn(() => true);
        await expect(theme.loadAssets(isCurrent)).resolves.toBe(bundle);
        expect(load).toHaveBeenCalledExactlyOnceWith({ isCurrent });
        // The loader, not the theme, decides when to ask; and loading alone publishes nothing.
        expect(isCurrent).not.toHaveBeenCalled();
        expect(theme.assets).toBeNull();
        // Called bare (the playground does), the load simply counts as current.
        await theme.loadAssets();
        expect(load).toHaveBeenCalledTimes(2);
        expect(load.mock.calls[1][0].isCurrent()).toBe(true);
    });
});

describe('Sakura board tracking', () => {
    it('measures the board on the first update and then about every three quarters of a second', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const { world } = theme;
        // createScene's own update(0) is the first poll; nothing is on the page, so the default stays.
        expect(world.setBoard).toHaveBeenCalledExactlyOnceWith(null);
        for (let frame = 0; frame < 14; frame += 1) theme.update(0.05);
        expect(world.setBoard).toHaveBeenCalledOnce();
        theme.update(0.05);
        theme.update(0.05);
        expect(world.setBoard).toHaveBeenCalledTimes(2);
        // Simulation time, not wall time: a long hitch is one clamped step, a paused frame is none.
        theme.update(10);
        for (const delta of [0, -1, NaN, Infinity, undefined]) theme.update(delta);
        expect(world.setBoard).toHaveBeenCalledTimes(2);
        for (let frame = 0; frame < 12; frame += 1) theme.update(0.05);
        expect(world.setBoard).toHaveBeenCalledTimes(2);
        for (let frame = 0; frame < 3; frame += 1) theme.update(0.05);
        expect(world.setBoard).toHaveBeenCalledTimes(3);
        // Every poll precedes that frame's world update.
        expect(world.setBoard.mock.invocationCallOrder[0]).toBeLessThan(world.update.mock.invocationCallOrder[0]);
    });

    it('hands the world the rectangle of the live board cards and follows them', async () => {
        const cards = [boardCard({
            left: 480, top: 90, width: 480, height: 720,
        })];
        showBoardCards(cards);
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const { world } = theme;
        expect(world.setBoard).toHaveBeenCalledExactlyOnceWith({
            x0: 480 / 1440, x1: 960 / 1440, y0: 0.1, y1: 0.9,
        });
        // A second board appears (local multiplayer): the stage spans both.
        cards.push(boardCard({
            left: 1000, top: 180, width: 360, height: 540,
        }));
        for (let frame = 0; frame < 16; frame += 1) theme.update(0.05);
        expect(world.setBoard).toHaveBeenCalledTimes(2);
        expect(world.setBoard).toHaveBeenLastCalledWith({
            x0: 480 / 1440, x1: 1360 / 1440, y0: 0.1, y1: 0.9,
        });
        // Back in a menu there is no board: the world is told so and falls back to its default.
        cards.length = 0;
        for (let frame = 0; frame < 16; frame += 1) theme.update(0.05);
        expect(world.setBoard).toHaveBeenCalledTimes(3);
        expect(world.setBoard).toHaveBeenLastCalledWith(null);
    });

    it('measures again at once after a restart and never without a world', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const first = theme.world;
        for (let frame = 0; frame < 5; frame += 1) theme.update(0.05);
        expect(first.setBoard).toHaveBeenCalledOnce();
        theme.stop();
        expect(() => { for (let frame = 0; frame < 40; frame += 1) theme.update(0.05); }).not.toThrow();
        expect(first.setBoard).toHaveBeenCalledOnce();
        theme.isActive = true;
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.world).not.toBe(first);
        expect(theme.world.setBoard).toHaveBeenCalledOnce();
        // A world from before the hook existed is tolerated.
        delete theme.world.setBoard;
        expect(() => { for (let frame = 0; frame < 40; frame += 1) theme.update(0.05); }).not.toThrow();
    });
});

describe('Sakura camera', () => {
    it('reframes on resize, rests where the world put the camera, and skips sizes it already has', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const {
            renderer, world, post, camera,
        } = theme;
        expect(renderer.setSize).toHaveBeenCalledExactlyOnceWith(1440, 900);
        expect(post.setSize).toHaveBeenCalledExactlyOnceWith(1440, 900);
        expect(world.prepareCamera).toHaveBeenCalledExactlyOnceWith(1440 / 900);
        expect(camera.aspect).toBe(1440 / 900);
        // The world frames the camera; the theme rests exactly there and looks the same way.
        world.prepareCamera.mockImplementation(() => {
            camera.position.set(0, 4.6, 19);
            camera.lookAt(-9, 10.5, -40);
        });
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 390, height: 844 });
        expect(renderer.setSize).toHaveBeenLastCalledWith(390, 844);
        expect(post.setSize).toHaveBeenLastCalledWith(390, 844);
        expect(world.prepareCamera).toHaveBeenLastCalledWith(390 / 844);
        expect(theme.restPosition.toArray()).toEqual([0, 4.6, 19]);
        const towards = new THREE.Vector3(-9, 10.5, -40).sub(theme.restPosition).normalize();
        expect(theme.restTarget.clone().sub(theme.restPosition).normalize().distanceTo(towards)).toBeLessThan(1e-9);
        // The same size again does nothing; nonsense falls back to the viewport.
        const calls = renderer.setSize.mock.calls.length;
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 390, height: 844 });
        expect(renderer.setSize).toHaveBeenCalledTimes(calls);
        for (const view of [undefined, {}, { width: 0, height: 0 }, { width: -5, height: 300 },
            { width: NaN, height: NaN }]) {
            eventBus.emit(EVENTS.VIEWPORT_RESIZED, view);
        }
        expect(renderer.setSize).toHaveBeenCalledTimes(calls + 1);
        expect(renderer.setSize).toHaveBeenLastCalledWith(1440, 900);
    });

    it('leans a little toward the mouse, eases there, and comes back to rest', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const move = windowListener('pointermove');
        expect(move).toBeTypeOf('function');
        const rest = theme.restPosition.clone();
        const settle = (frames = 240) => { for (let frame = 0; frame < frames; frame += 1) theme.update(1 / 60); };
        const aim = () => theme.camera.getWorldDirection(new THREE.Vector3());
        const ahead = aim();
        // Far right, a little below the middle.
        move({ clientX: 1440, clientY: 900, pointerType: 'mouse' });
        theme.update(1 / 60);
        const first = theme.camera.position.x - rest.x;
        expect(first).toBeGreaterThan(0);
        settle();
        const leaned = theme.camera.position.clone().sub(rest);
        expect(leaned.x).toBeGreaterThan(first * 5);
        expect(leaned.x).toBeLessThan(1.5);
        expect(leaned.y).toBeLessThan(0);
        expect(leaned.y).toBeGreaterThan(-1);
        expect(leaned.z).toBe(0);
        // It still looks out over the lake: a parallax, not a pan.
        expect(aim().angleTo(ahead)).toBeLessThan(0.05);
        // The rest pose itself never drifts.
        expect(theme.restPosition.equals(rest)).toBe(true);
        move({ clientX: 0, clientY: 0 });
        settle();
        expect(theme.camera.position.x).toBeLessThan(rest.x);
        expect(theme.camera.position.y).toBeGreaterThan(rest.y);
        // Positions off the window are clamped to its edge.
        move({ clientX: 99999, clientY: -99999, pointerType: 'mouse' });
        expect([theme.pointer.x, theme.pointer.y]).toEqual([1, -1]);
        // A finger on the board is not a mouse; a paused theme does not follow at all.
        move({ clientX: 720, clientY: 450, pointerType: 'mouse' });
        move({ clientX: 0, clientY: 0, pointerType: 'touch' });
        move({ clientX: 0, clientY: 0, pointerType: 'pen' });
        expect([theme.pointer.x, theme.pointer.y]).toEqual([0, 0]);
        theme.isPaused = true;
        move({ clientX: 1440, clientY: 450, pointerType: 'mouse' });
        expect([theme.pointer.x, theme.pointer.y]).toEqual([0, 0]);
        theme.isPaused = false;
        settle(600);
        expect(theme.camera.position.distanceTo(rest)).toBeLessThan(1e-3);
    });

    it('holds the camera still for players who ask for reduced motion', async () => {
        const query = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
        window.matchMedia = vi.fn(() => query);
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
        expect(theme.reducedMotion).toBe(true);
        const move = windowListener('pointermove');
        const rest = theme.restPosition.clone();
        move({ clientX: 1440, clientY: 0, pointerType: 'mouse' });
        for (let frame = 0; frame < 120; frame += 1) theme.update(1 / 60);
        expect([theme.pointer.x, theme.pointer.y]).toEqual([0, 0]);
        expect(theme.camera.position.equals(rest)).toBe(true);
        // The preference is followed live, both ways.
        const [[type, onChange]] = query.addEventListener.mock.calls;
        expect(type).toBe('change');
        query.matches = false;
        onChange();
        expect(theme.reducedMotion).toBe(false);
        move({ clientX: 1440, clientY: 450, pointerType: 'mouse' });
        for (let frame = 0; frame < 120; frame += 1) theme.update(1 / 60);
        expect(theme.camera.position.x).toBeGreaterThan(rest.x);
        query.matches = true;
        onChange();
        theme.update(1 / 60);
        expect(theme.camera.position.equals(rest)).toBe(true);
        expect([theme.pointer.sx, theme.pointer.sy]).toEqual([0, 0]);
        theme.stop();
        expect(query.removeEventListener).toHaveBeenCalledWith('change', onChange, undefined);
    });
});

describe('Sakura cadence and restart', () => {
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
        // The lens gets the same frame the garden did.
        expect(theme.post.update).toHaveBeenCalledExactlyOnceWith({ pulse: 0.2 });
        const order = [theme.reactions.update, theme.world.update, theme.post.update]
            .map((step) => step.mock.invocationCallOrder[0]);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(render).toHaveBeenCalledOnce();
        expect(liveRafs.size).toBe(1);
    });

    it('draws through the lens when there is one and straight to the renderer when there is not', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const { renderer, post } = theme;
        theme.renderFrame();
        expect(post.render).toHaveBeenCalledOnce();
        expect(renderer.render).not.toHaveBeenCalled();
        theme.post = null;
        theme.renderFrame();
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(theme.scene, theme.camera);
        post.dispose();
    });

    it('pauses itself and reports once when a frame throws', async () => {
        const theme = createTheme();
        theme.isActive = true;
        theme.hasStarted = true;
        stubSceneBuild(theme);
        await theme.createScene();
        theme.onRuntimeFailure = vi.fn();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(theme, 'shouldRenderFrame').mockReturnValue(true);
        theme.post.render.mockImplementation(() => { throw new Error('device lost'); });
        runFrame(0, 1000);
        expect(theme.isPaused).toBe(true);
        expect(theme.onRuntimeFailure)
            .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'device lost' }));
        expect(error).toHaveBeenCalledExactlyOnceWith('[Sakura] Render failed.', expect.any(Error));
        // The frame that was already queued does nothing, and nothing more is queued behind it.
        const queued = rafs.length;
        rafs.at(-1)(1016);
        expect(rafs).toHaveLength(queued);
        expect(theme.onRuntimeFailure).toHaveBeenCalledOnce();
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

    it('picks up a window that changed size while it was paused', async () => {
        const theme = createTheme();
        theme.isActive = true;
        theme.hasStarted = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const { renderer, world } = theme;
        theme.pause();
        window.innerWidth = 800;
        window.innerHeight = 600;
        expect(renderer.setSize).toHaveBeenCalledOnce();
        expect(theme.resume()).toBe(true);
        expect(renderer.setSize).toHaveBeenLastCalledWith(800, 600);
        expect(world.prepareCamera).toHaveBeenLastCalledWith(800 / 600);
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

    it('rebuilds once at the new tier when the quality setting changes', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const shared = { loadTheme: vi.fn() };
        const managers = { assetManager: { id: 'assets' }, audioManager: { id: 'audio' }, onRuntimeFailure: vi.fn() };
        Object.assign(theme, { webglRenderer: shared, ...managers });
        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'effectQuality', value: 'low' });
        // The running garden is untouched until the restart: only the target is recorded.
        expect(theme.quality).toBe('High');
        expect(theme.pendingQuality).toBe('Low');
        expect(start).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(start).toHaveBeenCalledExactlyOnceWith(shared, managers);
        // The same tier again asks for nothing more.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'effectQuality', value: 'Low' });
        await Promise.resolve();
        expect(start).toHaveBeenCalledOnce();
    });

    it('reports a rebuild that fails instead of losing it', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        theme.onRuntimeFailure = vi.fn();
        const failure = new Error('rebuild failed');
        vi.spyOn(theme, 'start').mockRejectedValue(failure);
        theme.handleSettingsChanged({ type: 'effectQuality', value: 'Minimal' });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(theme.onRuntimeFailure).toHaveBeenCalledExactlyOnceWith(failure);
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

    it('follows the legacy quality key only while the canonical one is unset', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        expect(window.settings.effectQuality).toBeUndefined();
        theme.handleSettingsChanged({ type: 'graphicsQuality', value: 'Medium' });
        await Promise.resolve();
        expect(start).toHaveBeenCalledOnce();
        expect(theme.pendingQuality).toBe('Medium');
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

describe('Sakura with its real artwork', () => {
    it('wires the loaded pack into garden, lens and director, and plays a session through the bus', async () => {
        const assets = await loadRealAssets();
        const theme = createTheme();
        theme.isActive = true;
        theme.loadAssets.mockResolvedValue(assets);
        const primed = vi.spyOn(SakuraWorld.prototype, 'primeShadows');
        await theme.createScene();
        const {
            renderer, world, post, reactions, scene, camera,
        } = theme;
        // The lens needed the moon's shadow rig: the garden primed it with its one cheap render.
        expect(primed).toHaveBeenCalledExactlyOnceWith(renderer);
        expect(primed.mock.contexts[0]).toBe(world);
        expect(world.group.children.every((part) => part.visible)).toBe(true);
        expect(theme.quality).toBe('High');
        expect(theme.assets).toBe(assets);
        expect(world).toBeInstanceOf(SakuraWorld);
        expect(world.assets).toBe(assets);
        expect(world.quality).toBe('High');
        expect(world.built).toBe(true);
        expect(world.scene).toBe(scene);
        expect(world.camera).toBe(camera);
        expect(scene.children).toEqual([world.group]);
        expect(theme.getWarmupRoots()).toEqual([world.group]);
        expect(reactions).toBeInstanceOf(SakuraReactions);
        expect(reactions.quality).toBe('High');
        expect(reactions.maxEmitters).toBe(SAKURA_REACTION_LIMITS.High);
        // The lens marches its beams through the garden's own moon.
        expect(post).toBeInstanceOf(SakuraPost);
        expect(post.light).toBe(world.light);
        expect(post.renderer).toBe(renderer);
        expect(post.getDiagnostics()).toEqual({
            quality: 'High', disabled: false, useMRT: false, godrays: true,
        });
        expect(renderer.shadowMap.enabled).toBe(true);
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        expect(world.getDiagnostics().trees).toBeGreaterThan(8);
        expect(world.petals.sim.count).toBe(SAKURA_TIERS.High.petals);
        expect(world.foxes.foxes).toHaveLength(2);
        // Framed by the world for this window, and the theme rests exactly there.
        const view = sakuraViewFor(1440 / 900);
        expect(camera.aspect).toBe(1440 / 900);
        expect(camera.fov).toBe(view.fov);
        expect(theme.restPosition.equals(camera.position)).toBe(true);
        const towards = new THREE.Vector3(...view.target).sub(camera.position).normalize();
        expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(towards)).toBeLessThan(1e-6);
        expect(world.stage.board).toEqual(SAKURA_DEFAULT_BOARD);
        expect(post.uAspect.value).toBe(1440 / 900);
        const restingBeams = post.uBeams.value;

        // A short session through the real bus.
        const piece = { x: 1, y: 20, shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] };
        const { sim } = world.petals;
        const reserve = sim.counts().idle;
        const seen = new Set();
        let peakBeams = restingBeams;
        const draw = vi.spyOn(post.pipeline, 'render').mockImplementation(() => {});
        let frames = 0;
        const play = (count) => {
            for (let step = 0; step < count; step += 1) {
                reactions.getFrame().emitters.forEach((emitter) => seen.add(emitter.kind));
                theme.update(1 / 60);
                theme.renderFrame();
                peakBeams = Math.max(peakBeams, post.uBeams.value);
                frames += 1;
            }
        };
        eventBus.emit(EVENTS.HARD_DROP, {
            piece, startY: 4, endY: 20, distance: 16,
        });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece });
        expect(reactions.getFrame().emitters.find((emitter) => emitter.kind === 'lock')).toMatchObject({ side: -1 });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [20, 21, 22, 23], cascadeCount: 1 });
        expect(reactions.getFrame().front).not.toBeNull();
        play(6);
        eventBus.emit(EVENTS.COMBO, { comboCount: 6 });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 2 });
        eventBus.emit(EVENTS.B2B, { active: true });
        play(6);
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 1, perfectClearBonus: 800 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        play(33);
        expect([...seen].sort())
            .toEqual(['clear', 'combo', 'floats', 'lanterns', 'lock', 'rise', 'shower', 'spin', 'star']);
        expect(draw).toHaveBeenCalledTimes(frames);
        expect(theme.time).toBeCloseTo(frames / 60, 9);
        expect(reactions.time).toBeCloseTo(frames / 60, 9);
        expect(world.light.uTime.value).toBeCloseTo(frames / 60, 9);
        expect(reactions.getFrame().vortex).toBeGreaterThan(0);
        expect(sim.counts().idle).toBeLessThan(reserve);
        expect(sim.outPosition.every(Number.isFinite)).toBe(true);
        expect(world.light.uGust.value).toBeGreaterThan(0);
        expect(world.spirits.uFoxfire.value).toBeGreaterThan(0);
        expect(world.light.ringData.some((ring) => ring.w > 0)).toBe(true);
        expect(peakBeams).toBeGreaterThan(restingBeams);

        // Game over lets the wind go; switching effects off empties the air at once.
        windowListener('gameOver')();
        expect(reactions.getFrame().front).toBeNull();
        expect(reactions.getFrame().emitters.length).toBeGreaterThan(0);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { changed: { backgroundComboEffects: false } });
        expect(reactions.getFrame().emitters).toEqual([]);
        expect(sim.counts().idle).toBe(reserve);
        expect(world.light.ringData.every((ring) => ring.w === 0)).toBe(true);
        // And nothing more is thrown while they are off.
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4 });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 1 });
        theme.update(1 / 60);
        expect(reactions.getFrame().emitters).toEqual([]);
        expect(sim.counts().idle).toBe(reserve);

        const disposals = realGeometries(assets).map((resource) => vi.spyOn(resource, 'dispose'));
        theme.stop();
        expect(world.disposed).toBe(true);
        expect(post.disposed).toBe(true);
        expect(reactions.disposed).toBe(true);
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(scene.children).toHaveLength(0);
        for (const key of ['renderer', 'world', 'post', 'reactions', 'assets', 'scene', 'camera', 'timer']) {
            expect(theme[key], key).toBeNull();
        }
    }, 120000);

    it('draws the Minimal garden directly, without a pipeline, as its tier says', async () => {
        window.settings.effectQuality = 'Minimal';
        const assets = await loadRealAssets();
        const theme = createTheme();
        theme.isActive = true;
        theme.loadAssets.mockResolvedValue(assets);
        await theme.createScene();
        const {
            renderer, world, post, scene, camera,
        } = theme;
        expect(theme.quality).toBe('Minimal');
        expect(world.tier).toBe(SAKURA_TIERS.Minimal);
        expect(world.petals.sim.count).toBe(SAKURA_TIERS.Minimal.petals);
        expect(theme.reactions.maxEmitters).toBe(SAKURA_REACTION_LIMITS.Minimal);
        expect(post.disabled).toBe(!SAKURA_TIERS.Minimal.post);
        expect(post.getDiagnostics()).toEqual({
            quality: 'Minimal', disabled: true, useMRT: false, godrays: false,
        });
        // No pipeline: nothing is rendered until the first frame, and that frame goes straight out.
        expect(renderer.render).not.toHaveBeenCalled();
        let toneDuringDraw;
        renderer.render.mockImplementation(() => { toneDuringDraw = renderer.toneMapping; });
        theme.update(1 / 60);
        theme.renderFrame();
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        expect(toneDuringDraw).toBe(THREE.ACESFilmicToneMapping);
        expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    }, 60000);

    it('plants the same garden for the same seed in the URL and a different one for another', async () => {
        window.settings.effectQuality = 'Minimal';
        const plant = async (search) => {
            window.location.search = search;
            const theme = createTheme();
            theme.isActive = true;
            theme.loadAssets.mockResolvedValue(await loadRealAssets());
            await theme.createScene();
            const placements = theme.world.forest.placements.map((tree) => [tree.asset, tree.x, tree.z]);
            theme.stop();
            return placements;
        };
        const usual = await plant('?forceWebGL=1');
        expect(await plant('?forceWebGL=1')).toEqual(usual);
        expect(await plant('?forceWebGL=1&sakuraSeed=')).toEqual(usual);
        expect(await plant('?forceWebGL=1&sakuraSeed=garbage')).toEqual(usual);
        const other = await plant('?forceWebGL=1&sakuraSeed=9001');
        expect(other).not.toEqual(usual);
        expect(await plant('?forceWebGL=1&sakuraSeed=9001')).toEqual(other);
    }, 120000);
});
