import { readFileSync } from 'node:fs';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import SummerTheme, { QUALITY_PRESETS, readSummerEventCount } from '../../src/themes/summer/summer-theme.js';
import * as summerAssets from '../../src/themes/summer/summer-assets.js';
import { summerViewFor } from '../../src/themes/summer/summer-composition.js';
import { SUMMER_FLOWERS } from '../../src/themes/summer/summer-flowers.js';
import { SUMMER_HOURS } from '../../src/themes/summer/summer-hours.js';
import { SummerPost } from '../../src/themes/summer/summer-post.js';
import { SUMMER_TIERS } from '../../src/themes/summer/summer-quality.js';
import {
    SUMMER_PIECE_FLOWERS, SUMMER_REACTION_LIMITS, SummerReactions,
} from '../../src/themes/summer/summer-reactions.js';
import { SUMMER_DEFAULT_BOARD } from '../../src/themes/summer/summer-stage.js';
import { SUMMER_TETROMINOS } from '../../src/themes/summer/summer-tetrominos.js';
import { SummerWorld } from '../../src/themes/summer/summer-world.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { setGlobalRenderScale } from '../../src/themes/base-theme.js';
import {
    GpuLossCoordinator, getGpuLossStats, initGpuLossCoordinator,
} from '../../src/utils/gpu-loss-coordinator.js';

vi.mock('../../src/utils/viewport.js', () => ({
    getViewport: () => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }),
}));

const rendererState = vi.hoisted(() => ({ candidates: [], init: () => Promise.resolve(), device: null }));

vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    class TestRenderer {
        constructor(options) {
            this.options = options;
            this.isWebGPURenderer = true;
            // A native backend owns a GPUDevice; the WebGL2 one does not.
            this.backend = options.forceWebGL
                ? { isWebGPUBackend: false }
                : { isWebGPUBackend: true, device: rendererState.device };
            this.domElement = {
                style: {},
                setAttribute: vi.fn(),
                parentNode: null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
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

const GAMEPLAY_EVENTS = [EVENTS.HARD_DROP, EVENTS.PIECE_LOCK, EVENTS.LINE_CLEAR, EVENTS.COMBO, EVENTS.TSPIN, EVENTS.B2B,
    EVENTS.PERFECT_CLEAR, EVENTS.LEVEL_UP];
const DIRECTOR_METHODS = ['onHardDrop', 'onPieceLock', 'onLineClear', 'onCombo', 'onTSpin', 'onBackToBack',
    'onPerfectClear', 'onLevelUp', 'onGameOver'];
const FLOURISHES = ['onTSpin', 'onBackToBack', 'onPerfectClear', 'onLevelUp'];
const RUNTIME_FIELDS = ['renderer', 'world', 'post', 'reactions', 'assets', 'timer', 'scene', 'camera'];
const TIER_NAMES = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
const PIECES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
const CONTAINER_ID = 'summer-theme';
const assetDirectory = new URL('../../src/themes/summer/assets/', import.meta.url);
// Building the real meadow takes a second or so on a busy machine.
const SLOW = 120000;

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

/** A theme under test. `resilience` leaves its GPU-loss wiring real instead of stubbing it out. */
function createTheme({ resilience = false } = {}) {
    const theme = new SummerTheme();
    themes.push(theme);
    if (!resilience) vi.spyOn(theme, 'setupGpuResilience').mockImplementation(() => {});
    // No GLB is fetched in this suite: every start receives a stand-in bundle unless a test loads one.
    theme.loadAssets = vi.fn(async () => ({ stub: true }));
    return theme;
}

function stubSceneBuild(theme) {
    vi.spyOn(theme, 'buildScene').mockImplementation(() => {
        theme.scene = new THREE.Scene();
        theme.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 3400);
        theme.camera.position.set(0, 4.7, 14.5);
        theme.camera.lookAt(0, 1.2, -45.5);
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
            setLevel: vi.fn(),
            getNight: vi.fn(() => ({ level: 3, hourTurn: 2, hourDrift: 0.25 })),
            restoreNight: vi.fn(),
            update: vi.fn(),
            reset: vi.fn(),
            dispose: vi.fn(),
            getFrame: () => ({ shimmer: 0.2 }),
        };
        theme.post = {
            update: vi.fn(), render: vi.fn(), setSize: vi.fn(), dispose: vi.fn(),
        };
        // As the real buildScene does: the first update of a new scene measures the board.
        theme.boardPoll = 0;
    });
}

/** A theme whose runtime is up, with stand-in artwork. */
async function startedTheme() {
    const theme = createTheme();
    theme.isActive = true;
    stubSceneBuild(theme);
    await theme.createScene();
    return theme;
}

/** A bundle shaped like the real one, whose every resource records its disposal. */
function stubAssets() {
    return {
        foliage: { variants: 2, meshes: { birch_spray_0: { dispose: vi.fn() }, spruce_frond_0: { dispose: vi.fn() } } },
        props: { variants: 2, meshes: { cottage: { dispose: vi.fn() }, maypole: { dispose: vi.fn() } } },
        trees: { 'birch-hero': { bark: { dispose: vi.fn() } }, 'spruce-grove-a': { bark: { dispose: vi.fn() } } },
        impostors: { tiles: [], texture: { dispose: vi.fn() } },
    };
}

function assetDisposals(assets) {
    return [...Object.values(assets.foliage.meshes), ...Object.values(assets.props.meshes),
        ...Object.values(assets.trees).map((tree) => tree.bark), assets.impostors.texture]
        .map((resource) => resource.dispose);
}

/** The real asset pack, parsed from disk; the sprite sheet is a stand-in data texture. */
async function loadRealAssets() {
    const parse = (file) => {
        const bytes = readFileSync(new URL(file, assetDirectory));
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return new GLTFLoader().parseAsync(buffer, '');
    };
    const names = Object.keys(summerAssets.SUMMER_TREE_URLS);
    const files = ['summer-foliage.glb', 'summer-props.glb', ...names.map((name) => `${name}.glb`)];
    const [foliage, props, ...trees] = await Promise.all(files.map(parse));
    const assets = {
        foliage: summerAssets.parseSummerMeshes(foliage, 'Foliage'),
        props: summerAssets.parseSummerMeshes(props, 'Props'),
        trees: {},
        impostors: null,
    };
    names.forEach((name, index) => {
        assets.trees[name] = summerAssets.parseSummerTree(trees[index], name);
    });
    const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4);
    assets.impostors = { ...summerAssets.summerImpostorLayout(), texture };
    return assets;
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

/** A GPUDevice as the resilience monitor sees it: a promise of its loss and an error channel. */
function fakeDevice(lost = new Promise(() => {})) {
    return { lost, addEventListener: vi.fn(), removeEventListener: vi.fn() };
}

/** How brightly each of the seven lanterns on the maypole burns. */
function lanterns(world) {
    const [low, high] = world.homestead.bouquetVectors;
    return [low.x, low.y, low.z, low.w, high.x, high.y, high.z];
}

beforeEach(() => {
    themes = [];
    rafs = [];
    liveRafs = new Map();
    rendererState.candidates = [];
    rendererState.init = () => Promise.resolve();
    rendererState.device = null;
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

describe('Summer theme identity and tables', () => {
    it('hands the board its own tetromino palette: the seven flowers', () => {
        const theme = createTheme();
        expect(theme.name).toBe('summer');
        expect(theme.resourceProfile).toBe('heavy-gpu');
        const config = theme.getTetrominoConfig();
        expect(config).toBe(SUMMER_TETROMINOS);
        expect(Object.keys(config.colors).sort()).toEqual(['CLEAN_GARBAGE', 'GARBAGE', ...PIECES]);
        for (const colour of Object.values(config.colors)) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
        // Seven pieces the player can tell apart at a glance, and from the garbage under them.
        expect(new Set(Object.values(config.colors)).size).toBe(Object.keys(config.colors).length);
        // Each piece is one of the seven kinds of flower, and wears the colour of its petals:
        // the meadow answers a lock with the same flower.
        expect(Object.keys(SUMMER_PIECE_FLOWERS).sort()).toEqual(PIECES);
        expect(Object.values(SUMMER_PIECE_FLOWERS).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
        for (const letter of PIECES) {
            const flower = SUMMER_FLOWERS.find((kind) => kind.piece === letter);
            expect(flower, letter).toBeDefined();
            expect(flower.slot, letter).toBe(SUMMER_PIECE_FLOWERS[letter]);
            expect(config.colors[letter], letter).toBe(`#${flower.petal.toString(16).padStart(6, '0')}`);
        }
        expect(config.renderMode).toBe('glow');
        expect(config.version).toBe(1);
        expect(Object.keys(config.rendererOverrides).sort()).toEqual(['canvas', 'phaser']);
        // It is available before the theme has ever started, and unchanged by starting.
        expect(theme.isActive).toBe(false);
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(theme.usesMrtScenePass()).toBe(false);
    });

    it('derives the presets generic readers see from the one tier table, for all six tiers', () => {
        const tiers = Object.keys(SUMMER_TIERS).sort();
        expect(tiers).toEqual([...TIER_NAMES].sort());
        expect(Object.keys(QUALITY_PRESETS).sort()).toEqual(tiers);
        expect(Object.keys(SUMMER_REACTION_LIMITS).sort()).toEqual(tiers);
        expect(Object.isFrozen(QUALITY_PRESETS)).toBe(true);
        for (const quality of tiers) {
            const tier = SUMMER_TIERS[quality];
            // The numbers are the table's, not a second copy that could drift.
            expect(QUALITY_PRESETS[quality], quality).toEqual({
                petalCount: tier.petals,
                flowerCount: tier.flowersNear + tier.flowersFar,
                birdCount: tier.birds,
                enablePost: tier.post,
                enablePostProcessing: tier.post,
            });
            expect(Object.isFrozen(QUALITY_PRESETS[quality])).toBe(true);
            expect(QUALITY_PRESETS[quality].petalCount).toBeGreaterThan(0);
            expect(QUALITY_PRESETS[quality].flowerCount).toBeGreaterThan(0);
            expect(QUALITY_PRESETS[quality].birdCount).toBeGreaterThanOrEqual(0);
            expect(typeof QUALITY_PRESETS[quality].enablePost).toBe('boolean');
            const theme = createTheme();
            theme.applyQualityPreset(quality.toLowerCase());
            expect(theme.quality).toBe(quality);
            expect(theme.qualityPreset).toBe(QUALITY_PRESETS[quality]);
        }
        // A cheaper tier never reports more than a dearer one.
        for (let index = 1; index < TIER_NAMES.length; index++) {
            const cheaper = QUALITY_PRESETS[TIER_NAMES[index]];
            const dearer = QUALITY_PRESETS[TIER_NAMES[index - 1]];
            for (const key of ['petalCount', 'flowerCount', 'birdCount']) {
                expect(cheaper[key], `${TIER_NAMES[index]}.${key}`).toBeLessThanOrEqual(dearer[key]);
            }
            expect(Number(cheaper.enablePost)).toBeLessThanOrEqual(Number(dearer.enablePost));
        }
        // A new theme starts on the default tier's preset.
        expect(createTheme().qualityPreset).toBe(QUALITY_PRESETS.High);
        // An unknown tier name reads as the default one.
        const theme = createTheme();
        theme.applyQualityPreset('potato');
        expect(QUALITY_PRESETS[theme.quality]).toBe(theme.qualityPreset);
        expect(theme.qualityPreset).toBeDefined();
    });

    it('reads the tier to build from the settings, preferring the canonical key', () => {
        const theme = createTheme();
        window.settings = { graphicsQuality: 'Low' };
        expect(theme.getCurrentQualityLevel()).toBe('Low');
        window.settings = { effectQuality: 'ultra', graphicsQuality: 'Low' };
        expect(theme.getCurrentQualityLevel()).toBe('Ultra');
        window.settings = undefined;
        expect(Object.keys(SUMMER_TIERS)).toContain(theme.getCurrentQualityLevel());
    });
});

describe('Summer gameplay payloads', () => {
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
        [{ lineCount: -2.5 }, ['lineCount', 'count', 'lines'], 1, -3],
        [2.9, ['lineCount', 'count', 'lines'], 1, 2],
        ['7', ['comboCount', 'combo', 'count'], 0, 7],
        [{ detail: 5 }, ['comboCount', 'combo', 'count'], 0, 5],
        [undefined, ['lineCount', 'count', 'lines'], 1, 1],
        [null, ['comboCount', 'combo', 'count'], 0, 0],
        [{}, ['lineCount', 'count', 'lines'], 9, 9],
    ])('normalizes count %j', (payload, keys, fallback, expected) => {
        expect(readSummerEventCount(payload, keys, fallback)).toBe(expected);
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
        const piece = {
            x: 3, y: 18, shape: [[1]], shapeKey: 'O',
        };
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
        // The lock's piece is how the meadow knows which flower to answer with.
        expect(reactions.onPieceLock.mock.calls[0][0].piece).toBe(piece);
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

    it('turns the night on a level-up whatever the effect setting says, and keeps the flourish for effects on', () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        theme.buildScene();
        theme.setupEventListeners();
        // Effects on: the flourish carries the level to the director itself.
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        expect(theme.reactions.onLevelUp).toHaveBeenCalledExactlyOnceWith({ level: 2 });
        expect(theme.reactions.setLevel).not.toHaveBeenCalled();
        // Effects off: no flourish, but the night still moves on an hour.
        theme.comboEffects = false;
        eventBus.emit(EVENTS.LEVEL_UP, { detail: { level: 3 } });
        expect(theme.reactions.onLevelUp).toHaveBeenCalledOnce();
        expect(theme.reactions.setLevel).toHaveBeenCalledExactlyOnceWith(3);
        // Paused: the same, so the game is not a level ahead of the sky when it resumes.
        theme.comboEffects = true;
        theme.isPaused = true;
        eventBus.emit(EVENTS.LEVEL_UP, { level: 4 });
        expect(theme.reactions.setLevel).toHaveBeenLastCalledWith(4);
        expect(theme.reactions.setLevel).toHaveBeenCalledTimes(2);
        expect(theme.reactions.onLevelUp).toHaveBeenCalledOnce();
        // Not this theme's scene any more: nothing.
        theme.isPaused = false;
        theme.isActive = false;
        eventBus.emit(EVENTS.LEVEL_UP, { level: 5 });
        theme.isActive = true;
        theme.cleanupComplete = true;
        eventBus.emit(EVENTS.LEVEL_UP, { level: 6 });
        expect(theme.reactions.setLevel).toHaveBeenCalledTimes(2);
        expect(theme.reactions.onLevelUp).toHaveBeenCalledOnce();
        theme.cleanupComplete = false;
        // A payload without a level is handed on as it is: the director decides what it means.
        expect(() => theme.onLevelUp(undefined)).not.toThrow();
        expect(() => theme.onLevelUp(null)).not.toThrow();
        expect(theme.reactions.onLevelUp).toHaveBeenCalledTimes(3);
        theme.comboEffects = false;
        expect(() => theme.onLevelUp(undefined)).not.toThrow();
        expect(theme.reactions.setLevel).toHaveBeenLastCalledWith(undefined);
        theme.reactions = null;
        expect(() => theme.onLevelUp({ level: 9 })).not.toThrow();
    });

    it('keeps where the night stands when effects are switched off and when the scene is taken down', async () => {
        const theme = await startedTheme();
        expect(theme.night).toBeNull();
        // Switching effects off empties the air; it is not a new night.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { changed: { backgroundComboEffects: false } });
        expect(theme.reactions.reset).toHaveBeenCalledExactlyOnceWith({ keepNight: true });
        // Taking the scene down asks the director where the night stands, before it is reset.
        const { reactions } = theme;
        theme.disposeRuntime();
        expect(reactions.getNight).toHaveBeenCalledOnce();
        expect(reactions.getNight.mock.invocationCallOrder[0])
            .toBeLessThan(reactions.reset.mock.invocationCallOrder[1]);
        expect(theme.night).toEqual({ level: 3, hourTurn: 2, hourDrift: 0.25 });
        // Taken down again with nothing built, it keeps what it had.
        theme.disposeRuntime();
        expect(theme.night).toEqual({ level: 3, hourTurn: 2, hourDrift: 0.25 });
    });

    const suppressedStates = ['inactive', 'paused', 'disabled', 'hidden', 'rendering-paused', 'cleaned-up'];
    it.each(suppressedStates)('suppresses every %s reaction', (state) => {
        const theme = createTheme();
        theme.isActive = state !== 'inactive';
        theme.isPaused = state === 'paused';
        // With the background effects switched off nothing at all answers the game.
        if (state === 'disabled') window.settings.backgroundComboEffects = false;
        if (state === 'hidden') document.hidden = true;
        if (state === 'rendering-paused') window.isRenderingPaused = true;
        stubSceneBuild(theme);
        theme.buildScene();
        theme.setupEventListeners();
        if (state === 'cleaned-up') theme.cleanupComplete = true;
        expect(theme.effectsAllowed()).toBe(false);
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
        // Undo the terminal flag so the shared teardown can stop this theme.
        theme.cleanupComplete = false;
    });

    it.each([
        ['false', false], ['0', false], ['off', false], [' NO ', false], [false, false],
        ['true', true], ['1', true], ['on', true], [true, true], [undefined, true], [null, true], ['maybe', true],
    ])('reads backgroundComboEffects = %j as effects %s', (value, allowed) => {
        const theme = createTheme();
        theme.isActive = true;
        window.settings.backgroundComboEffects = value;
        stubSceneBuild(theme);
        theme.buildScene();
        theme.setupEventListeners();
        expect(theme.comboEffects).toBe(allowed);
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2 });
        eventBus.emit(EVENTS.PIECE_LOCK, {});
        expect(theme.reactions.onLineClear).toHaveBeenCalledTimes(allowed ? 1 : 0);
        expect(theme.reactions.onPieceLock).toHaveBeenCalledTimes(allowed ? 1 : 0);
    });

    it('blocks only locks and hard drops when the lock ripple is switched off', () => {
        const theme = createTheme();
        theme.isActive = true;
        window.settings.pieceLockRipple = false;
        stubSceneBuild(theme);
        theme.buildScene();
        theme.setupEventListeners();
        expect(theme.lockRipple).toBe(false);
        expect(theme.effectsAllowed()).toBe(true);
        theme.onPieceLock();
        theme.onLineClear(4);
        theme.onCombo(8);
        expect(theme.reactions.onPieceLock).not.toHaveBeenCalled();
        expect(theme.reactions.onLineClear).toHaveBeenCalledOnce();
        expect(theme.reactions.onCombo).toHaveBeenCalledOnce();
        // The drop only ever strengthens the lock's answer, so it obeys the same setting.
        theme.onHardDrop({ distance: 12 });
        eventBus.emit(EVENTS.HARD_DROP, { distance: 12 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { x: 1, y: 2 } });
        expect(theme.reactions.onHardDrop).not.toHaveBeenCalled();
        expect(theme.reactions.onPieceLock).not.toHaveBeenCalled();
        // Everything else still answers through the bus.
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 3 });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 1 });
        eventBus.emit(EVENTS.B2B, { active: true });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        expect(theme.reactions.onLineClear).toHaveBeenCalledTimes(2);
        expect(theme.reactions.onCombo).toHaveBeenCalledTimes(2);
        for (const method of FLOURISHES) expect(theme.reactions[method], method).toHaveBeenCalledOnce();

        // And the other way round: effects off silences the flourishes whatever the ripple says.
        theme.comboEffects = false;
        theme.lockRipple = true;
        for (const event of GAMEPLAY_EVENTS) eventBus.emit(event, { lineCount: 2, comboCount: 4, distance: 9 });
        for (const method of FLOURISHES) expect(theme.reactions[method], method).toHaveBeenCalledOnce();
        expect(theme.reactions.onPieceLock).not.toHaveBeenCalled();
        expect(theme.reactions.onHardDrop).not.toHaveBeenCalled();
    });

    it.each([
        ['false', false], ['0', false], ['off', false], [false, false], [true, true], [undefined, true],
    ])('reads pieceLockRipple = %j as lock answers %s', (value, allowed) => {
        const theme = createTheme();
        theme.isActive = true;
        window.settings.pieceLockRipple = value;
        stubSceneBuild(theme);
        theme.buildScene();
        theme.setupEventListeners();
        expect(theme.lockRipple).toBe(allowed);
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { x: 1, y: 2 } });
        eventBus.emit(EVENTS.HARD_DROP, { distance: 4 });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2 });
        expect(theme.reactions.onPieceLock).toHaveBeenCalledTimes(allowed ? 1 : 0);
        expect(theme.reactions.onHardDrop).toHaveBeenCalledTimes(allowed ? 1 : 0);
        expect(theme.reactions.onLineClear).toHaveBeenCalledOnce();
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
        // A combo without a count is passed on as zero for the director to decline.
        theme.onCombo({});
        theme.onCombo({ comboCount: -4 });
        expect(theme.reactions.onCombo.mock.calls).toEqual([[0, {}], [0, { comboCount: -4 }]]);
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
        const theme = await startedTheme();
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { detail: { changed: { backgroundComboEffects: 'false' } } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { x: 2 } });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 8 });
        expect(theme.reactions.reset).toHaveBeenCalledOnce();
        // The envelopes and the petals already in flight go together: director and world.
        expect(theme.world.resetEffects).toHaveBeenCalledOnce();
        expect(theme.reactions.reset.mock.invocationCallOrder[0])
            .toBeLessThan(theme.world.resetEffects.mock.invocationCallOrder[0]);
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

    it('hears the same settings from the DOM event, and tolerates a world without the hook', async () => {
        const theme = await startedTheme();
        windowListener('settingsChanged')({ detail: { settings: { backgroundComboEffects: false } } });
        expect(theme.comboEffects).toBe(false);
        expect(theme.reactions.reset).toHaveBeenCalledOnce();
        expect(theme.world.resetEffects).toHaveBeenCalledOnce();
        delete theme.world.resetEffects;
        theme.comboEffects = true;
        expect(() => windowListener('settingsChanged')({ type: 'backgroundComboEffects', value: false })).not.toThrow();
        expect(theme.comboEffects).toBe(false);
        expect(theme.reactions.reset).toHaveBeenCalledTimes(2);
        // Payloads that say nothing about a setting change nothing.
        for (const payload of [undefined, null, 7, 'settings', {}, { detail: null }, { changed: {} }]) {
            expect(() => windowListener('settingsChanged')(payload)).not.toThrow();
        }
        expect(theme.comboEffects).toBe(false);
        expect(theme.reactions.reset).toHaveBeenCalledTimes(2);
    });

    it('tells the director the game is over instead of wiping it', async () => {
        const theme = await startedTheme();
        const { reactions, world } = theme;
        const gameOver = windowListener('gameOver');
        expect(gameOver).toBeTypeOf('function');
        gameOver({ type: 'gameOver' });
        expect(reactions.onGameOver).toHaveBeenCalledOnce();
        expect(reactions.reset).not.toHaveBeenCalled();
        expect(world.resetEffects).not.toHaveBeenCalled();
        // The evening is settled even while reactions are switched off.
        theme.comboEffects = false;
        gameOver();
        expect(reactions.onGameOver).toHaveBeenCalledTimes(2);
        theme.stop();
        expect(window.removeEventListener).toHaveBeenCalledWith('gameOver', gameOver, undefined);
        expect(() => gameOver()).not.toThrow();
        expect(reactions.onGameOver).toHaveBeenCalledTimes(2);
    });
});

describe('Summer renderer ownership', () => {
    it('refuses to start without its container, before any renderer exists', async () => {
        document.getElementById = () => null;
        const theme = createTheme();
        theme.isActive = true;
        const build = vi.spyOn(theme, 'buildScene');
        await expect(theme.createScene()).rejects.toThrow('[Summer] Theme container not found.');
        expect(rendererState.candidates).toHaveLength(0);
        expect(theme.loadAssets).not.toHaveBeenCalled();
        expect(build).not.toHaveBeenCalled();
        expect(rafs).toHaveLength(0);
        for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(0);
    });

    it('fails start() without a container and starts once the page has one', async () => {
        const page = document.getElementById;
        document.getElementById = () => null;
        const theme = createTheme();
        stubSceneBuild(theme);
        const shared = { loadTheme: vi.fn() };
        await expect(theme.start(shared, {})).rejects.toThrow('[Summer] Theme container not found.');
        expect(theme.lifecycleState).toBe('failed');
        expect(theme.isActive).toBe(false);
        expect(rendererState.candidates).toHaveLength(0);
        document.getElementById = page;
        await theme.start(shared, {});
        expect(theme.lifecycleState).toBe('running');
        expect(container.children).toEqual([theme.renderer.domElement]);
    });

    it('falls back from WebGPU to the node WebGL2 renderer when native initialization fails', async () => {
        window.location.search = '';
        rendererState.init = (renderer) => (renderer.options.forceWebGL
            ? Promise.resolve() : Promise.reject(new Error('native unavailable')));
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(rendererState.candidates.map((renderer) => renderer.options.forceWebGL)).toEqual([false, true]);
        for (const candidate of rendererState.candidates) {
            expect(candidate.options).toMatchObject({ alpha: false, powerPreference: 'high-performance' });
            expect(candidate.init).toHaveBeenCalledOnce();
        }
        expect(console.warn).toHaveBeenCalledWith(
            '[Summer] WebGPU initialization failed; trying node WebGL2.',
            expect.objectContaining({ message: 'native unavailable' }),
        );
        // Same node materials on the fallback backend; only the backend flag differs.
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(container.children).toHaveLength(1);
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
        expect(rendererState.candidates[1].dispose).not.toHaveBeenCalled();
        // The meadow is lit through a shadow map on whichever backend it ends up with.
        expect(theme.renderer).toBe(rendererState.candidates[1]);
        expect(theme.renderer.shadowMap.enabled).toBe(true);
        expect(theme.loadAssets).toHaveBeenCalledOnce();
        expect(theme.buildScene).toHaveBeenCalledOnce();
        expect(liveRafs.size).toBe(1);
    });

    it('goes straight to WebGL2 where the browser has no WebGPU at all', async () => {
        window.location.search = '';
        vi.stubGlobal('navigator', {});
        const theme = await startedTheme();
        expect(rendererState.candidates).toHaveLength(1);
        expect(rendererState.candidates[0].options.forceWebGL).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.usesNodeMaterials).toBe(true);
    });

    it.each([
        ['?forceWebGL'], ['?forceWebGL=1'], ['?summerForceWebGL=true'], ['?theme=x&forceWebGL=on'],
        ['?summerForceWebGL'], ['?FORCEWEBGL=0&summerForceWebGL=YES'],
    ])('honors the %s URL flag without attempting native initialization', async (search) => {
        window.location.search = search;
        await startedTheme();
        expect(rendererState.candidates).toHaveLength(1);
        expect(rendererState.candidates[0].options.forceWebGL).toBe(true);
        expect(rendererState.candidates[0].init).toHaveBeenCalledOnce();
    });

    it.each([
        ['?forceWebGL=0'], ['?summerForceWebGL=false'], ['?goldenForestForceWebGL=1'], ['?forceWebGLish=1'], [''],
    ])('does not take %j for the WebGL2 flag', async (search) => {
        window.location.search = search;
        const theme = await startedTheme();
        expect(rendererState.candidates).toHaveLength(1);
        expect(rendererState.candidates[0].options.forceWebGL).toBe(false);
        expect(theme.isWebGPU).toBe(true);
    });

    it('uses the native renderer when it initializes, with shadows on before any artwork exists', async () => {
        window.location.search = '?forceWebGL=0';
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
        expect(rendererState.candidates[0].options.forceWebGL).toBe(false);
        expect(theme.isWebGPU).toBe(true);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(shadowsAtBuild).toBe(true);
        const { renderer } = theme;
        // An opaque clear colour: the canvas is never see-through.
        expect(renderer.setClearColor).toHaveBeenCalledExactlyOnceWith(expect.any(Number), 1);
        expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
        expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
        // The canvas is decorative and never takes the pointer from the board.
        expect(renderer.domElement.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
        expect(renderer.domElement.style.cssText).toContain('pointer-events:none');
        expect(container.appendChild).toHaveBeenCalledExactlyOnceWith(renderer.domElement);
    });

    it('rejects the start when neither backend can initialize, leaving nothing behind', async () => {
        window.location.search = '';
        rendererState.init = (renderer) => Promise.reject(
            new Error(renderer.options.forceWebGL ? 'no webgl2' : 'no webgpu'),
        );
        const theme = createTheme();
        theme.isActive = true;
        const build = vi.spyOn(theme, 'buildScene');
        const failure = await theme.createScene().catch((error) => error);
        expect(failure).toBeInstanceOf(Error);
        expect(failure.message).toBe('Summer could not initialize WebGPU or WebGL2.');
        expect(failure.cause.message).toBe('no webgl2');
        expect(rendererState.candidates).toHaveLength(2);
        rendererState.candidates.forEach((candidate) => expect(candidate.dispose).toHaveBeenCalledOnce());
        expect(container.appendChild).not.toHaveBeenCalled();
        expect(theme.loadAssets).not.toHaveBeenCalled();
        expect(build).not.toHaveBeenCalled();
        for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
        expect(rafs).toHaveLength(0);
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
        // A start that never owned a renderer never asks for the assets either.
        expect(theme.loadAssets).not.toHaveBeenCalled();
    });

    it('does not fall back to WebGL2 for a start that was stopped while WebGPU was failing', async () => {
        window.location.search = '';
        const pending = deferred();
        rendererState.init = () => pending.promise;
        const theme = createTheme();
        theme.isActive = true;
        const start = theme.createScene();
        await vi.waitFor(() => expect(rendererState.candidates[0]?.init).toHaveBeenCalledOnce());
        theme.stop();
        pending.reject(new Error('native unavailable'));
        await expect(start).resolves.toBeUndefined();
        // No second candidate was created for a theme nobody is looking at.
        expect(rendererState.candidates).toHaveLength(1);
        expect(theme.renderer).toBeNull();
        expect(container.appendChild).not.toHaveBeenCalled();
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

    it('preserves the static registry container through terminal cleanup', async () => {
        const theme = await startedTheme();
        expect(theme.containers).toEqual([]);
        theme.cleanup();
        expect(container.parentNode.removeChild).not.toHaveBeenCalled();
        expect(container.children).toHaveLength(0);
        expect(theme.cleanupComplete).toBe(true);
    });
});

describe('Summer GPU-loss recovery', () => {
    function surfaces() {
        initGpuLossCoordinator();
        return getGpuLossStats().registeredSurfaces;
    }

    it('watches the canvas and the device of a native runtime and registers one recovery for it', async () => {
        window.location.search = '';
        const device = fakeDevice();
        rendererState.device = device;
        const before = surfaces();
        const register = vi.spyOn(GpuLossCoordinator.prototype, 'registerSurface');
        const theme = createTheme({ resilience: true });
        const watch = vi.spyOn(theme, 'setupRendererResilience');
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const { renderer } = theme;
        expect(theme.isWebGPU).toBe(true);
        // The resilience monitor is handed this runtime's canvas and its device ...
        expect(watch).toHaveBeenCalledExactlyOnceWith(renderer, { webgpuDevice: device });
        expect(renderer.domElement.addEventListener)
            .toHaveBeenCalledWith('webglcontextlost', expect.any(Function), false);
        expect(device.addEventListener).toHaveBeenCalledWith('uncapturederror', expect.any(Function));
        // ... and the coordinator one recovery, under the theme's own name.
        expect(register).toHaveBeenCalledExactlyOnceWith('summer', { recover: expect.any(Function) });
        expect(surfaces()).toBe(before + 1);
        expect(theme.gpuSurfaceUnregister).toBeTypeOf('function');
        expect(theme.gpuRecoveryAttempted).toBe(false);
        expect(theme.forceWebGL).toBe(false);
        // All of it goes with the runtime.
        theme.stop();
        expect(surfaces()).toBe(before);
        expect(theme.gpuSurfaceUnregister).toBeNull();
        expect(renderer.domElement.removeEventListener)
            .toHaveBeenCalledWith('webglcontextlost', expect.any(Function), false);
        expect(device.removeEventListener).toHaveBeenCalledWith('uncapturederror', expect.any(Function));
        expect(() => theme.stop()).not.toThrow();
        expect(surfaces()).toBe(before);
    });

    it('registers nothing for a WebGL2 runtime, whose context the browser restores itself', async () => {
        const before = surfaces();
        const register = vi.spyOn(GpuLossCoordinator.prototype, 'registerSurface');
        const theme = createTheme({ resilience: true });
        const watch = vi.spyOn(theme, 'setupRendererResilience');
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(theme.isWebGPU).toBe(false);
        expect(watch).toHaveBeenCalledExactlyOnceWith(theme.renderer, { webgpuDevice: null });
        expect(theme.renderer.domElement.addEventListener)
            .toHaveBeenCalledWith('webglcontextlost', expect.any(Function), false);
        expect(register).not.toHaveBeenCalled();
        expect(surfaces()).toBe(before);
        expect(theme.gpuSurfaceUnregister).toBeNull();
    });

    it('recovers once by restarting through start() on WebGL2, and refuses a second attempt', async () => {
        window.location.search = '';
        rendererState.device = fakeDevice();
        const register = vi.spyOn(GpuLossCoordinator.prototype, 'registerSurface');
        const theme = createTheme({ resilience: true });
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const [[, surface]] = register.mock.calls;
        theme.webglRenderer = { loadTheme: vi.fn() };
        theme.assetManager = { id: 'assets' };
        theme.audioManager = { id: 'audio' };
        theme.onRuntimeFailure = vi.fn();
        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        await surface.recover();
        // A device that was lost once is not trusted again: the restart is on the WebGL2 backend.
        expect(theme.forceWebGL).toBe(true);
        expect(theme.gpuRecoveryAttempted).toBe(true);
        expect(start).toHaveBeenCalledExactlyOnceWith(theme.webglRenderer, {
            assetManager: theme.assetManager,
            audioManager: theme.audioManager,
            onRuntimeFailure: theme.onRuntimeFailure,
        });
        // A second loss must not loop: the coordinator routes the player out instead.
        await expect(surface.recover()).rejects.toThrow('Summer WebGPU recovery already attempted.');
        expect(start).toHaveBeenCalledOnce();

        // A theme that was switched away meanwhile is marked, but not restarted.
        const idle = createTheme({ resilience: true });
        idle.isActive = true;
        stubSceneBuild(idle);
        await idle.createScene();
        const [, [, idleSurface]] = register.mock.calls;
        const idleStart = vi.spyOn(idle, 'start').mockResolvedValue();
        idle.isActive = false;
        await idleSurface.recover();
        expect(idle.forceWebGL).toBe(true);
        expect(idleStart).not.toHaveBeenCalled();
        idle.isActive = true;
    });

    it('rebuilds on the node WebGL2 backend when the WebGPU device is really lost', async () => {
        window.location.search = '';
        const lost = deferred();
        rendererState.device = fakeDevice(lost.promise);
        const before = surfaces();
        const theme = createTheme({ resilience: true });
        stubSceneBuild(theme);
        const shared = { loadTheme: vi.fn() };
        await theme.start(shared, { onRuntimeFailure: vi.fn() });
        const [native] = rendererState.candidates;
        expect(theme.renderer).toBe(native);
        expect(theme.isWebGPU).toBe(true);
        expect(surfaces()).toBe(before + 1);
        const { world } = theme;

        // The device dies (a driver reset, say): the monitor reports it on the bus, the
        // coordinator calls this theme's recovery, and the theme starts over.
        lost.resolve({ reason: 'unknown', message: 'device hung' });
        await vi.waitFor(() => expect(rendererState.candidates).toHaveLength(2));
        await vi.waitFor(() => expect(theme.renderer).toBe(rendererState.candidates[1]));
        await vi.waitFor(() => expect(theme.lifecycleState).toBe('running'));
        expect(rendererState.candidates.map((candidate) => candidate.options.forceWebGL)).toEqual([false, true]);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.forceWebGL).toBe(true);
        expect(theme.gpuRecoveryAttempted).toBe(true);
        // The lost runtime was retired, and the new one is the only thing on the page.
        expect(native.dispose).toHaveBeenCalledOnce();
        expect(world.dispose).toHaveBeenCalledOnce();
        expect(theme.world).not.toBe(world);
        expect(container.children).toEqual([theme.renderer.domElement]);
        expect(liveRafs.size).toBe(1);
        expect(theme.loadAssets).toHaveBeenCalledTimes(2);
        expect(theme.buildScene).toHaveBeenCalledTimes(2);
        expect(shared.loadTheme).toHaveBeenCalledTimes(2);
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(1);
        // The WebGL2 runtime needs no recovery of its own.
        expect(surfaces()).toBe(before);
        // And every later start stays on WebGL2, whatever the URL says.
        await theme.start(shared, {});
        expect(rendererState.candidates.at(-1).options.forceWebGL).toBe(true);
        expect(rendererState.candidates).toHaveLength(3);
    });
});

describe('Summer runtime disposal', () => {
    it('releases every owned resource and subscription once, however often it is disposed', async () => {
        window.location.search = '?forceWebGL=1&themeValidation=1';
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        const bundle = stubAssets();
        theme.loadAssets.mockResolvedValue(bundle);
        await theme.createScene();
        const {
            renderer, world, post, reactions, timer, scene,
        } = theme;
        const timerDispose = vi.spyOn(timer, 'dispose');
        const sceneClear = vi.spyOn(scene, 'clear');
        expect(window.__SUMMER__).toBe(theme);
        expect(theme.getWarmupRoots()).toEqual([world.group]);
        expect(theme.assets).toBe(bundle);
        expect(liveRafs.size).toBe(1);
        const generation = theme.runtimeGeneration;

        theme.disposeRuntime();
        theme.disposeRuntime();
        theme.stop();
        theme.stop();
        theme.cleanup();
        theme.cleanup();
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(world.dispose).toHaveBeenCalledOnce();
        expect(post.dispose).toHaveBeenCalledOnce();
        expect(reactions.dispose).toHaveBeenCalledOnce();
        expect(timerDispose).toHaveBeenCalledOnce();
        expect(sceneClear).toHaveBeenCalledOnce();
        assetDisposals(bundle).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
        // The lens goes before the world it reads, the world before the pack it borrows.
        expect(post.dispose.mock.invocationCallOrder[0]).toBeLessThan(world.dispose.mock.invocationCallOrder[0]);
        expect(world.dispose.mock.invocationCallOrder[0])
            .toBeLessThan(bundle.trees['birch-hero'].bark.dispose.mock.invocationCallOrder[0]);
        expect(container.children).toEqual([]);
        expect(liveRafs.size).toBe(0);
        expect(theme.animationIds).toEqual([]);
        expect(theme.animationLoopStarted).toBe(false);
        expect(theme.eventUnsubscribers).toEqual([]);
        expect(theme._eventListeners).toEqual([]);
        for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
        expect(theme.isWebGPU).toBe(false);
        expect(theme.usesNodeMaterials).toBe(false);
        expect(theme.appliedSize).toBeNull();
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(window.__SUMMER__).toBeUndefined();
        // Every disposal retires whatever was still in flight for the old runtime.
        expect(theme.runtimeGeneration).toBeGreaterThan(generation);
        eventBus.emit(EVENTS.COMBO, { comboCount: 8 });
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 390, height: 844 });
        for (const event of GAMEPLAY_EVENTS) {
            eventBus.emit(event, { lineCount: 2 });
            expect(eventBus.listenerCount(event)).toBe(0);
        }
        expect(eventBus.listenerCount(EVENTS.SETTINGS_CHANGED)).toBe(0);
        expect(eventBus.listenerCount(EVENTS.VIEWPORT_RESIZED)).toBe(0);
        for (const method of DIRECTOR_METHODS) expect(reactions[method]).not.toHaveBeenCalled();
        // A disposed theme can be driven without effect or error.
        expect(() => {
            theme.update(0.016);
            theme.renderFrame();
            theme.resize(800, 600);
            theme.handleSettingsChanged({ type: 'effectQuality', value: 'Low' });
        }).not.toThrow();
        expect(renderer.setSize).toHaveBeenCalledOnce();
    });

    it('publishes itself for validation only when the URL asks, and never another theme\'s handle', async () => {
        const quiet = await startedTheme();
        expect(window.__SUMMER__).toBeUndefined();
        quiet.stop();
        window.location.search = '?forceWebGL=1&themeValidation';
        const first = await startedTheme();
        expect(window.__SUMMER__).toBe(first);
        // A second instance takes the handle over; stopping the first must not clear it.
        const second = await startedTheme();
        expect(window.__SUMMER__).toBe(second);
        first.stop();
        expect(window.__SUMMER__).toBe(second);
        second.stop();
        expect(window.__SUMMER__).toBeUndefined();
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
        const { world, renderer } = theme;
        theme[end]();
        theme[end]();
        expect(theme.assets).toBeNull();
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(renderer.dispose).toHaveBeenCalledOnce();
        assetDisposals(bundle).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
        // The world borrows the bundle's geometry, so it lets go first.
        expect(world.dispose.mock.invocationCallOrder[0])
            .toBeLessThan(bundle.trees['birch-hero'].bark.dispose.mock.invocationCallOrder[0]);
        expect(liveRafs.size).toBe(0);
    });

    it('goes on releasing the rest when one part fails to dispose', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        const bundle = stubAssets();
        theme.loadAssets.mockResolvedValue(bundle);
        await theme.createScene();
        const {
            renderer, world, post, reactions,
        } = theme;
        post.dispose.mockImplementation(() => { throw new Error('lens stuck'); });
        world.dispose.mockImplementation(() => { throw new Error('meadow stuck'); });
        expect(() => theme.disposeRuntime()).not.toThrow();
        expect(console.warn).toHaveBeenCalledWith('[Summer] Post disposal failed.', expect.any(Error));
        expect(console.warn).toHaveBeenCalledWith('[Summer] World disposal failed.', expect.any(Error));
        expect(reactions.dispose).toHaveBeenCalledOnce();
        expect(renderer.dispose).toHaveBeenCalledOnce();
        assetDisposals(bundle).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
        for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
        expect(container.children).toHaveLength(0);
    });

    it('detaches synchronously while observing asynchronous renderer disposal', async () => {
        const theme = await startedTheme();
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
});

describe('Summer asset loading', () => {
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
        // The load finishes after the stop: its assets are released, not kept and not built from.
        const bundle = stubAssets();
        pending.resolve(bundle);
        await start;
        expect(build).not.toHaveBeenCalled();
        for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
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
        // The newer start wins.
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

    it('fails start() on an asset error, stays restartable and starts cleanly the second time', async () => {
        const theme = createTheme();
        stubSceneBuild(theme);
        const shared = { loadTheme: vi.fn() };
        const bundle = stubAssets();
        theme.loadAssets.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(bundle);
        await expect(theme.start(shared, {})).rejects.toThrow('offline');
        expect(theme.lifecycleState).toBe('failed');
        expect(theme.isActive).toBe(false);
        expect(theme.buildScene).not.toHaveBeenCalled();
        expect(container.children).toHaveLength(0);
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
        expect(liveRafs.size).toBe(0);
        expect(theme.eventUnsubscribers).toEqual([]);
        for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(0);

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

    it('cleans up and rethrows when the artwork fails to build', async () => {
        const theme = createTheme();
        theme.isActive = true;
        const bundle = stubAssets();
        theme.loadAssets.mockResolvedValue(bundle);
        const partial = { dispose: vi.fn() };
        vi.spyOn(theme, 'buildScene').mockImplementation(() => {
            theme.scene = new THREE.Scene();
            theme.world = partial;
            throw new Error('shader graph exploded');
        });
        await expect(theme.createScene()).rejects.toThrow('shader graph exploded');
        // What had been made is released, the pack included, and nothing is left running.
        expect(partial.dispose).toHaveBeenCalledOnce();
        assetDisposals(bundle).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
        for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
        expect(container.children).toHaveLength(0);
        expect(rafs).toHaveLength(0);
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(0);
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

    it('delegates loading to the asset module with the ownership predicate it was given', async () => {
        const bundle = stubAssets();
        const load = vi.spyOn(summerAssets, 'loadSummerAssets').mockResolvedValue(bundle);
        const theme = new SummerTheme();
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

describe('Summer board tracking and camera', () => {
    it('measures the board on the first update and then every 0.75 s of simulation time', async () => {
        const theme = await startedTheme();
        const { world } = theme;
        // createScene's own update(0) is the first poll; nothing is on the page, so the default stays.
        expect(world.setBoard).toHaveBeenCalledExactlyOnceWith(null);
        for (let frame = 0; frame < 14; frame++) theme.update(0.05);
        expect(world.setBoard).toHaveBeenCalledOnce();
        theme.update(0.05);
        theme.update(0.05);
        expect(world.setBoard).toHaveBeenCalledTimes(2);
        // Simulation time, not wall time: a long hitch is one clamped step, a paused frame is none.
        theme.update(10);
        for (const delta of [0, -1, NaN, Infinity, undefined]) theme.update(delta);
        expect(world.setBoard).toHaveBeenCalledTimes(2);
        for (let frame = 0; frame < 12; frame++) theme.update(0.05);
        expect(world.setBoard).toHaveBeenCalledTimes(2);
        for (let frame = 0; frame < 3; frame++) theme.update(0.05);
        expect(world.setBoard).toHaveBeenCalledTimes(3);
        // Every poll precedes that frame's world update.
        expect(world.setBoard.mock.invocationCallOrder[0]).toBeLessThan(world.update.mock.invocationCallOrder[0]);
    });

    it('hands the world the rectangle of the live board cards and follows them', async () => {
        const cards = [boardCard({
            left: 480, top: 90, width: 480, height: 720,
        })];
        showBoardCards(cards);
        const theme = await startedTheme();
        const { world } = theme;
        expect(world.setBoard).toHaveBeenCalledExactlyOnceWith({
            x0: 480 / 1440, x1: 960 / 1440, y0: 0.1, y1: 0.9,
        });
        // A second board appears (local multiplayer): the stage spans both.
        cards.push(boardCard({
            left: 1000, top: 180, width: 360, height: 540,
        }));
        for (let frame = 0; frame < 16; frame++) theme.update(0.05);
        expect(world.setBoard).toHaveBeenCalledTimes(2);
        expect(world.setBoard).toHaveBeenLastCalledWith({
            x0: 480 / 1440, x1: 1360 / 1440, y0: 0.1, y1: 0.9,
        });
        // Back in a menu there is no board: the world is told so and falls back to its default.
        cards.length = 0;
        for (let frame = 0; frame < 16; frame++) theme.update(0.05);
        expect(world.setBoard).toHaveBeenCalledTimes(3);
        expect(world.setBoard).toHaveBeenLastCalledWith(null);
    });

    it('feeds every frame to the director, the world and the lens with a clamped, monotonic clock', async () => {
        const theme = await startedTheme();
        const { reactions, world, post } = theme;
        world.update.mockClear();
        post.update.mockClear();
        reactions.update.mockClear();
        theme.update(1 / 60);
        expect(reactions.update).toHaveBeenCalledExactlyOnceWith(1 / 60);
        expect(world.update).toHaveBeenCalledExactlyOnceWith(1 / 60, 1 / 60, { shimmer: 0.2 });
        // The lens gets the same frame, stamped with the simulation clock.
        expect(post.update).toHaveBeenCalledExactlyOnceWith({ shimmer: 0.2, time: 1 / 60 });
        expect(reactions.update.mock.invocationCallOrder[0]).toBeLessThan(world.update.mock.invocationCallOrder[0]);
        expect(world.update.mock.invocationCallOrder[0]).toBeLessThan(post.update.mock.invocationCallOrder[0]);
        const before = theme.time;
        // A hitch is clamped to a twentieth of a second; nonsense does not move the clock at all.
        theme.update(5);
        expect(theme.time).toBeCloseTo(before + 0.05, 12);
        for (const delta of [0, -3, NaN, Infinity, -Infinity, undefined, null, '0.1']) theme.update(delta);
        expect(theme.time).toBeCloseTo(before + 0.05, 12);
        for (const [time, dt] of world.update.mock.calls) {
            expect(Number.isFinite(time) && Number.isFinite(dt)).toBe(true);
            expect(dt).toBeGreaterThanOrEqual(0);
            expect(dt).toBeLessThanOrEqual(0.05);
        }
    });

    it('lets the mouse lean the camera a little about its rest pose, and stills it for reduced motion', async () => {
        const theme = await startedTheme();
        const { camera } = theme;
        const rest = theme.restPosition.clone();
        expect(rest.equals(camera.position)).toBe(true);
        const move = windowListener('pointermove');
        move({ clientX: 1440, clientY: 0, pointerType: 'mouse' });
        expect(theme.pointer).toMatchObject({ x: 1, y: -1 });
        for (let frame = 0; frame < 240; frame++) theme.update(1 / 60);
        // Toward the pointer, by well under a metre: parallax, not a camera move. The rest
        // pose itself never drifts.
        const lean = camera.position.clone().sub(rest);
        expect(lean.x).toBeGreaterThan(0.1);
        expect(lean.x).toBeLessThan(1);
        expect(lean.y).toBeGreaterThan(0.05);
        expect(lean.y).toBeLessThan(0.5);
        expect(camera.position.z).toBe(rest.z);
        expect(theme.restPosition.equals(rest)).toBe(true);
        // It eases there rather than jumping.
        move({ clientX: 0, clientY: 900, pointerType: 'mouse' });
        theme.update(1 / 60);
        expect(camera.position.x - rest.x).toBeGreaterThan(lean.x * 0.8);
        expect(camera.position.x - rest.x).toBeLessThan(lean.x);
        // Touches and pens do not steer the view; positions off the window are clamped.
        move({ clientX: 720, clientY: 450, pointerType: 'touch' });
        expect(theme.pointer).toMatchObject({ x: -1, y: 1 });
        move({ clientX: 99999, clientY: -99999 });
        expect(theme.pointer).toMatchObject({ x: 1, y: -1 });
        // Paused, the pointer is ignored.
        theme.isPaused = true;
        move({ clientX: 0, clientY: 0, pointerType: 'mouse' });
        expect(theme.pointer.x).toBe(1);
        theme.isPaused = false;

        // Reduced motion: the camera sits on its rest pose whatever the pointer does.
        window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
        theme.setupEventListeners();
        expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
        expect(theme.reducedMotion).toBe(true);
        expect(theme.pointer).toEqual({
            x: 0, y: 0, sx: 0, sy: 0,
        });
        windowListener('pointermove')({ clientX: 1440, clientY: 0, pointerType: 'mouse' });
        for (let frame = 0; frame < 30; frame++) theme.update(1 / 60);
        expect(camera.position.equals(rest)).toBe(true);
    });

    it('re-frames through the world on a real resize only, and rests the camera where the world put it', async () => {
        const theme = await startedTheme();
        const {
            renderer, world, post, camera,
        } = theme;
        expect(renderer.setSize).toHaveBeenCalledExactlyOnceWith(1440, 900);
        expect(renderer.setPixelRatio).toHaveBeenCalledOnce();
        expect(post.setSize).toHaveBeenCalledExactlyOnceWith(1440, 900);
        expect(world.prepareCamera).toHaveBeenCalledExactlyOnceWith(1440 / 900);
        expect(camera.aspect).toBe(1440 / 900);
        // The same size again is not a resize.
        theme.resize(1440, 900);
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 1440, height: 900 });
        expect(renderer.setSize).toHaveBeenCalledOnce();
        // A phone turned upright: the world chooses the framing, the theme rests on it.
        world.prepareCamera.mockImplementation(() => camera.position.set(0, 4.2, 16.5));
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 390, height: 844 });
        expect(renderer.setSize).toHaveBeenLastCalledWith(390, 844);
        expect(post.setSize).toHaveBeenLastCalledWith(390, 844);
        expect(world.prepareCamera).toHaveBeenLastCalledWith(390 / 844);
        expect(camera.aspect).toBe(390 / 844);
        expect(theme.restPosition.toArray()).toEqual([0, 4.2, 16.5]);
        // Nonsense sizes fall back to the window's own.
        for (const [width, height] of [[0, 0], [-5, 100], [NaN, NaN], [undefined, undefined]]) {
            theme.resize(width, height);
        }
        expect(renderer.setSize).toHaveBeenLastCalledWith(1440, 900);
        expect(renderer.setSize).toHaveBeenCalledTimes(3);
    });
});

describe('Summer cadence, pause and quality changes', () => {
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
        expect(timer.update).toHaveBeenCalledExactlyOnceWith(1200);
        expect(theme.reactions.update).toHaveBeenCalledExactlyOnceWith(0.05);
        expect(theme.world.update).toHaveBeenCalledExactlyOnceWith(0.05, 0.05, { shimmer: 0.2 });
        expect(render).toHaveBeenCalledOnce();
        expect(liveRafs.size).toBe(1);
        // A second startAnimation while one loop is alive starts no other.
        theme.startAnimation();
        expect(rafs).toHaveLength(4);
    });

    it('draws through the lens when there is one and straight to the renderer when there is not', async () => {
        const theme = await startedTheme();
        const {
            renderer, post, scene, camera,
        } = theme;
        theme.renderFrame();
        expect(post.render).toHaveBeenCalledOnce();
        expect(renderer.render).not.toHaveBeenCalled();
        theme.post = null;
        theme.renderFrame();
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        theme.post = post;
    });

    it('starts, stops and starts again through the manager\'s entry points', async () => {
        const theme = createTheme();
        stubSceneBuild(theme);
        const shared = { loadTheme: vi.fn() };
        expect(theme.lifecycleState).toBe('initialized');
        await theme.start(shared, {});
        expect(theme.lifecycleState).toBe('running');
        expect(theme.isActive).toBe(true);
        expect(theme.hasStarted).toBe(true);
        expect(shared.loadTheme).toHaveBeenCalledExactlyOnceWith('summer');
        expect(container.classList.add).toHaveBeenCalledWith('active');
        const first = theme.renderer;
        expect(container.children).toEqual([first.domElement]);
        expect(liveRafs.size).toBe(1);
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(1);

        theme.stop();
        expect(theme.lifecycleState).toBe('stopped');
        expect(theme.isActive).toBe(false);
        expect(first.dispose).toHaveBeenCalledOnce();
        expect(container.children).toEqual([]);
        expect(container.classList.remove).toHaveBeenCalledWith('active');
        expect(liveRafs.size).toBe(0);
        for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(0);
        // The frame that was queued when it stopped does nothing.
        const queued = rafs.length;
        rafs.at(-1)(1000);
        expect(rafs).toHaveLength(queued);

        await theme.start(shared, {});
        expect(theme.lifecycleState).toBe('running');
        expect(theme.renderer).not.toBe(first);
        expect(container.children).toEqual([theme.renderer.domElement]);
        expect(liveRafs.size).toBe(1);
        expect(theme.loadAssets).toHaveBeenCalledTimes(2);
        // Starting a running theme replaces its runtime rather than doubling it.
        const second = theme.renderer;
        await theme.start(shared, {});
        expect(second.dispose).toHaveBeenCalledOnce();
        expect(container.children).toEqual([theme.renderer.domElement]);
        expect(liveRafs.size).toBe(1);
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(1);
        // After terminal cleanup it cannot come back.
        theme.cleanup();
        await expect(theme.start(shared, {})).rejects.toThrow('cannot restart after terminal cleanup');
        theme.cleanupComplete = false;
    });

    it('pauses its loop and its clock, and resumes exactly one loop', async () => {
        const theme = await startedTheme();
        theme.hasStarted = true;
        const { timer, renderer } = theme;
        const timerReset = vi.spyOn(timer, 'reset');
        expect(rafs).toHaveLength(1);
        expect(liveRafs.size).toBe(1);
        expect(theme.pause()).toBe(true);
        expect(theme.isPaused).toBe(true);
        expect(theme.animationLoopStarted).toBe(false);
        expect(liveRafs.size).toBe(0);
        expect(timerReset).toHaveBeenCalledOnce();
        // Pausing twice is refused, and does not touch the clock again.
        expect(theme.pause()).toBe(false);
        expect(timerReset).toHaveBeenCalledOnce();
        // The frame that was already queued does nothing once it fires.
        const stale = rafs[0];
        stale(1000);
        expect(rafs).toHaveLength(1);
        expect(theme.world.update).toHaveBeenCalledOnce();
        // Gameplay does not reach a paused meadow.
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4 });
        expect(theme.reactions.onLineClear).not.toHaveBeenCalled();

        renderer.setSize.mockClear();
        window.innerWidth = 1024;
        window.innerHeight = 768;
        expect(theme.resume()).toBe(true);
        expect(theme.isPaused).toBe(false);
        expect(timerReset.mock.calls.length).toBeGreaterThanOrEqual(2);
        // It re-measures the window it wakes up in.
        expect(renderer.setSize).toHaveBeenCalledExactlyOnceWith(1024, 768);
        expect(rafs).toHaveLength(2);
        expect(liveRafs.size).toBe(1);
        // The manager restarting the loop as well must not double it.
        theme.restartRenderLoop();
        expect(rafs).toHaveLength(2);
        expect(theme.animationLoopStarted).toBe(true);
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4 });
        expect(theme.reactions.onLineClear).toHaveBeenCalledOnce();
        // Resuming something that is not paused is refused.
        expect(theme.resume()).toBe(false);
        expect(rafs).toHaveLength(2);
    });

    it('refuses to resume without a runtime so the manager restarts it instead', async () => {
        const theme = createTheme();
        expect(theme.resume()).toBe(false);
        theme.isActive = true;
        theme.hasStarted = true;
        stubSceneBuild(theme);
        await theme.createScene();
        theme.pause();
        const { world } = theme;
        theme.world = null;
        expect(theme.resume()).toBe(false);
        expect(theme.isPaused).toBe(true);
        expect(liveRafs.size).toBe(0);
        theme.world = world;
        expect(theme.resume()).toBe(true);
    });

    it('pauses itself and reports once when a frame throws', async () => {
        const theme = await startedTheme();
        theme.onRuntimeFailure = vi.fn();
        vi.spyOn(theme, 'shouldRenderFrame').mockReturnValue(true);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const failure = new Error('device lost');
        theme.post.render.mockImplementation(() => { throw failure; });
        runFrame(0, 1000);
        expect(theme.isPaused).toBe(true);
        expect(theme.onRuntimeFailure).toHaveBeenCalledExactlyOnceWith(failure);
        expect(error).toHaveBeenCalledExactlyOnceWith('[Summer] Render failed.', failure);
        // The loop does not spin on a broken frame.
        expect(liveRafs.size).toBe(0);
        const queued = rafs.length;
        rafs.at(-1)(1016);
        expect(rafs).toHaveLength(queued);
        expect(theme.onRuntimeFailure).toHaveBeenCalledOnce();
    });

    it('queues one rebuild for a settings-driven quality change', async () => {
        window.settings.effectQuality = 'High';
        const theme = await startedTheme();
        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        expect(theme.quality).toBe('High');
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'effectQuality', value: 'low' });
        // Queued, not started: the settings dispatch finishes first.
        expect(theme.pendingQuality).toBe('Low');
        expect(theme.rebuildQueued).toBe(true);
        expect(start).not.toHaveBeenCalled();
        expect(theme.quality).toBe('High');
        await Promise.resolve();
        expect(start).toHaveBeenCalledOnce();
        expect(start).toHaveBeenCalledWith(theme.webglRenderer, {
            assetManager: theme.assetManager,
            audioManager: theme.audioManager,
            onRuntimeFailure: theme.onRuntimeFailure,
        });
        expect(theme.rebuildQueued).toBe(false);
        // The same tier announced again asks for nothing more.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { changed: { effectQuality: 'Low' } });
        await Promise.resolve();
        expect(start).toHaveBeenCalledOnce();
        // Settings that are not about quality never rebuild the meadow.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { changed: { musicVolume: 0.2, backgroundComboEffects: true } });
        await Promise.resolve();
        expect(start).toHaveBeenCalledOnce();
    });

    it('builds at the pending tier when the queued rebuild really restarts the theme', async () => {
        window.settings.effectQuality = 'High';
        const theme = createTheme();
        stubSceneBuild(theme);
        const builtTiers = [];
        const buildScene = theme.buildScene.getMockImplementation();
        theme.buildScene.mockImplementation(() => {
            builtTiers.push(theme.quality);
            buildScene();
        });
        await theme.start({ loadTheme: vi.fn() }, {});
        const first = theme.renderer;
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'effectQuality', value: 'Minimal' });
        await vi.waitFor(() => expect(builtTiers).toEqual(['High', 'Minimal']));
        await vi.waitFor(() => expect(theme.lifecycleState).toBe('running'));
        expect(theme.quality).toBe('Minimal');
        expect(theme.qualityPreset).toBe(QUALITY_PRESETS.Minimal);
        expect(theme.pendingQuality).toBeNull();
        // The old runtime was retired and a new one published in its place.
        expect(first.dispose).toHaveBeenCalledOnce();
        expect(theme.renderer).not.toBe(first);
        expect(container.children).toEqual([theme.renderer.domElement]);
        expect(liveRafs.size).toBe(1);
        expect(theme.loadAssets).toHaveBeenCalledTimes(2);
    });

    it('reports a failed rebuild to the runtime-failure hook instead of leaving it unhandled', async () => {
        const theme = await startedTheme();
        theme.onRuntimeFailure = vi.fn();
        const failure = new Error('rebuild failed');
        vi.spyOn(theme, 'start').mockRejectedValue(failure);
        theme.handleSettingsChanged({ type: 'effectQuality', value: 'Low' });
        await vi.waitFor(() => expect(theme.onRuntimeFailure).toHaveBeenCalledExactlyOnceWith(failure));
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
        // And an inactive theme does not even queue one.
        theme.handleSettingsChanged({ type: 'effectQuality', value: 'Minimal' });
        await Promise.resolve();
        expect(start).not.toHaveBeenCalled();
        expect(theme.rebuildQueued).toBe(false);
    });

    it('parks quality changes during pause and requests one rebuild on resume', async () => {
        const theme = await startedTheme();
        theme.hasStarted = true;
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
        window.settings.effectQuality = 'High';
        const theme = await startedTheme();
        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        theme.handleSettingsChanged({ type: 'graphicsQuality', value: 'Extreme' });
        await Promise.resolve();
        expect(start).not.toHaveBeenCalled();
        theme.handleSettingsChanged({ type: 'effectQuality', value: 'Low' });
        theme.handleSettingsChanged({ detail: { changed: { effectQuality: 'Minimal' } } });
        await Promise.resolve();
        expect(start).toHaveBeenCalledOnce();
        expect(theme.pendingQuality).toBe('Minimal');
        // Where only the legacy key exists, it is the quality setting.
        window.settings = {};
        const legacy = await startedTheme();
        const legacyStart = vi.spyOn(legacy, 'start').mockResolvedValue();
        legacy.handleSettingsChanged({ type: 'graphicsQuality', value: 'Low' });
        await Promise.resolve();
        expect(legacyStart).toHaveBeenCalledOnce();
        expect(legacy.pendingQuality).toBe('Low');
    });

    it('does not apply an obsolete quality target when the player immediately restores the current tier', async () => {
        window.settings.effectQuality = 'High';
        const theme = await startedTheme();
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
        expect(theme.rebuildPending).toBe(false);
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

    // The asset pack is awaited after the renderer initialises and before listeners attach, so the
    // settings are reconciled a second time once it has loaded: a quality change made during the
    // load decides the tier the meadow is built at.
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
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'effectQuality', value: 'High' });
        pending.resolve(stubAssets());
        await start;
        await Promise.resolve();
        // Building High outright, or building Low and queueing the rebuild, would both be fine.
        expect(theme.pendingQuality ?? theme.quality).toBe('High');
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

    it('changes internal pixel ratio on renderScale updates with unchanged viewport dimensions', async () => {
        const theme = await startedTheme();
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

    it('caps the pixel ratio lower on cheaper tiers, and never above the device\'s own', async () => {
        window.devicePixelRatio = 3;
        const started = await Promise.all(TIER_NAMES.map(async (quality) => {
            const theme = createTheme();
            theme.isActive = true;
            // The tier a rebuild was queued for; the settings themselves name none.
            theme.pendingQuality = quality;
            stubSceneBuild(theme);
            await theme.createScene();
            return theme;
        }));
        const ratios = {};
        started.forEach((theme, index) => {
            const quality = TIER_NAMES[index];
            expect(theme.quality).toBe(quality);
            expect(theme.renderer.setPixelRatio).toHaveBeenCalledOnce();
            [[ratios[quality]]] = theme.renderer.setPixelRatio.mock.calls;
            expect(ratios[quality]).toBeGreaterThan(0);
            expect(ratios[quality]).toBeLessThanOrEqual(3);
        });
        for (let index = 1; index < TIER_NAMES.length; index++) {
            expect(ratios[TIER_NAMES[index]], TIER_NAMES[index]).toBeLessThanOrEqual(ratios[TIER_NAMES[index - 1]]);
        }
        expect(ratios.Minimal).toBeLessThan(ratios.Extreme);
    });

    it('ignores stale renderScale work and frame callbacks after a replacement runtime is published', async () => {
        const theme = await startedTheme();
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
        expect(world.update).toHaveBeenCalledExactlyOnceWith(0, 0, { shimmer: 0.2 });
        expect(liveRafs.size).toBe(1);
    });
});

describe('Summer with its real artwork', () => {
    it('wires the loaded pack into meadow, lens and director, and plays a session through the bus', async () => {
        const assets = await loadRealAssets();
        const theme = createTheme();
        theme.isActive = true;
        theme.loadAssets.mockResolvedValue(assets);
        await theme.createScene();
        const {
            renderer, world, post, reactions, scene, camera,
        } = theme;
        expect(theme.quality).toBe('High');
        expect(theme.assets).toBe(assets);
        expect(world).toBeInstanceOf(SummerWorld);
        expect(world.assets).toBe(assets);
        expect(world.quality).toBe('High');
        expect(world.built).toBe(true);
        expect(world.scene).toBe(scene);
        expect(world.camera).toBe(camera);
        expect(scene.children).toEqual([world.group]);
        expect(theme.getWarmupRoots()).toEqual([world.group]);
        expect(reactions).toBeInstanceOf(SummerReactions);
        expect(reactions.quality).toBe('High');
        expect(reactions.maxEmitters).toBe(SUMMER_REACTION_LIMITS.High);
        // The lens marches its shafts through the meadow's own sun.
        expect(post).toBeInstanceOf(SummerPost);
        expect(post.light).toBe(world.light);
        expect(post.renderer).toBe(renderer);
        expect(post.getDiagnostics()).toEqual({
            quality: 'High', disabled: false, useMRT: false, godrays: true,
        });
        expect(renderer.shadowMap.enabled).toBe(true);
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        // What the world draws is what the preset tells generic readers.
        const diagnostics = world.getDiagnostics();
        expect(diagnostics.trees).toBeGreaterThan(9);
        expect(world.petals.sim.count).toBe(QUALITY_PRESETS.High.petalCount);
        expect(diagnostics.swallows).toBe(QUALITY_PRESETS.High.birdCount);
        expect(diagnostics.flowers).toBeLessThanOrEqual(QUALITY_PRESETS.High.flowerCount);
        expect(diagnostics.flowers).toBeGreaterThan(QUALITY_PRESETS.High.flowerCount * 0.8);
        // Framed by the world for this window, and the theme rests exactly there.
        const view = summerViewFor(1440 / 900);
        expect(camera.aspect).toBe(1440 / 900);
        expect(camera.fov).toBe(view.fov);
        expect(theme.restPosition.equals(camera.position)).toBe(true);
        const towards = new THREE.Vector3(...view.target).sub(camera.position).normalize();
        expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(towards)).toBeLessThan(1e-6);
        expect(world.stage.board).toEqual(SUMMER_DEFAULT_BOARD);
        expect(post.uAspect.value).toBe(1440 / 900);
        const restingShafts = post.uShafts.value;
        // The first frame has already run: every lantern is dark and nothing is in the air.
        expect(lanterns(world)).toEqual([0, 0, 0, 0, 0, 0, 0]);

        // A short session through the real bus.
        const piece = {
            x: 1, y: 20, shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]], shapeKey: 'T',
        };
        const { sim } = world.petals;
        const { ripples } = world.lake;
        const { waves } = world.light;
        expect(sim.counts().live).toBe(0);
        expect(ripples.active()).toBe(0);
        expect(waves.active()).toBe(0);
        eventBus.emit(EVENTS.HARD_DROP, {
            piece, startY: 4, endY: 20, distance: 16,
        });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [20, 21, 22, 23], cascadeCount: 1 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 6 });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 2 });
        eventBus.emit(EVENTS.B2B, { active: true });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 1, perfectClearBonus: 800 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        const frame = reactions.getFrame();
        const kinds = frame.emitters.map((emitter) => emitter.kind);
        for (const kind of ['lock', 'clear', 'combo', 'spin', 'rise']) expect(kinds, kind).toContain(kind);
        expect(kinds.length).toBeLessThanOrEqual(SUMMER_REACTION_LIMITS.High);
        expect(frame.front).not.toBeNull();
        expect(frame.flock).toBe(1);
        // The lock was read from the piece itself: the left of the board, and its own flower.
        expect(frame.emitters.find((emitter) => emitter.kind === 'lock'))
            .toMatchObject({ side: -1, flower: SUMMER_PIECE_FLOWERS.T });
        expect(frame.rings.filter((ring) => ring.serial >= 0).length).toBeGreaterThan(4);
        expect(frame.waves.filter((wave) => wave.serial >= 0).length).toBeGreaterThan(2);
        expect(frame.epoch).toBe(1);
        const draw = vi.spyOn(post.pipeline, 'render').mockImplementation(() => {});
        for (let step = 0; step < 45; step++) {
            theme.update(1 / 60);
            theme.renderFrame();
        }
        expect(draw).toHaveBeenCalledTimes(45);
        expect(theme.time).toBeCloseTo(0.75, 9);
        expect(reactions.time).toBeCloseTo(0.75, 9);
        expect(world.light.uTime.value).toBeCloseTo(0.75, 9);
        expect(reactions.getFrame().crown).toBeGreaterThan(0);
        expect(sim.counts().live).toBeGreaterThan(100);
        expect(sim.outPlace.every(Number.isFinite)).toBe(true);
        expect(ripples.active()).toBeGreaterThan(4);
        expect(waves.active()).toBeGreaterThan(2);
        expect(world.light.uGust.value).toBeGreaterThan(0);
        expect(world.life.uStartle.value).toBeGreaterThan(0.5);
        expect(world.lake.uShimmer.value).toBeGreaterThan(0.3);
        expect(post.uShafts.value).toBeGreaterThan(restingShafts);
        // The piece's flower is picked for the bouquet, and the combo has called the ribbons.
        const lit = [0, 0, 0, 0, 0, 0, 0];
        lit[SUMMER_PIECE_FLOWERS.T] = 1;
        expect(lanterns(world)).toEqual(lit);
        expect(world.garlands.uLevel.value).toBeGreaterThan(0.5);
        expect(world.garlands.group.children.every((ribbon) => ribbon.visible)).toBe(true);

        // Game over settles the evening; switching effects off empties the air and stills the water at once.
        windowListener('gameOver')();
        expect(reactions.getFrame().front).toBeNull();
        expect(reactions.getFrame().settled).toBe(true);
        expect(reactions.getFrame().emitters.length).toBeGreaterThan(0);
        theme.update(1 / 60);
        expect(world.director.env.settled).toBe(true);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { changed: { backgroundComboEffects: false } });
        expect(reactions.getFrame().emitters).toEqual([]);
        expect(sim.counts().live).toBe(0);
        expect(ripples.active()).toBe(0);
        expect(waves.active()).toBe(0);
        // With effects off the game no longer reaches the meadow.
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece });
        theme.update(1 / 60);
        expect(sim.counts().live).toBe(0);
        expect(lanterns(world)).toEqual([0, 0, 0, 0, 0, 0, 0]);
        expect(world.garlands.group.children.every((ribbon) => !ribbon.visible)).toBe(true);
        // Switched back on, the next lock is the first event of a new epoch, numbered from
        // zero like the first lock of the session before it: it must not be taken for that one.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { changed: { backgroundComboEffects: true } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece });
        expect(reactions.getFrame().emitters.map((emitter) => emitter.serial)).toEqual([0]);
        theme.update(1 / 60);
        expect(reactions.getFrame().epoch).toBe(2);
        expect(world.director.epoch).toBe(2);
        expect(sim.counts().live).toBeGreaterThan(0);
        expect(ripples.active()).toBe(1);
        expect(waves.active()).toBe(1);
        expect(lanterns(world)).toEqual(lit);

        const disposals = [
            ...Object.values(assets.foliage.meshes),
            ...Object.values(assets.props.meshes),
            ...Object.values(assets.trees).map((tree) => tree.bark),
            assets.impostors.texture,
        ].map((resource) => vi.spyOn(resource, 'dispose'));
        theme.stop();
        expect(world.disposed).toBe(true);
        expect(post.disposed).toBe(true);
        expect(reactions.disposed).toBe(true);
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(scene.children).toHaveLength(0);
        for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
    }, SLOW);

    it('turns the night with the levels, lights the scene by it, and takes it up again after a rebuild', async () => {
        const theme = createTheme();
        theme.isActive = true;
        theme.loadAssets.mockResolvedValue(await loadRealAssets());
        await theme.createScene();
        const { world, reactions, post } = theme;
        const { light } = world;
        vi.spyOn(post.pipeline, 'render').mockImplementation(() => {});
        const close = (colour, expected) => colour.toArray().forEach(
            (channel, index) => expect(channel).toBeCloseTo(expected[index], 5),
        );
        // The first frame has run: the evening, at level 1.
        expect(reactions.getFrame()).toMatchObject({ level: 1, hour: 0 });
        close(light.uSunColor.value, SUMMER_HOURS[0].sun);
        close(light.uZenith.value, SUMMER_HOURS[0].zenith);
        expect(light.uLamps.value).toBe(1);
        expect(post.uExposure.value).toBeCloseTo(post.exposure, 9);
        const sunDirection = light.uSunDir.value.clone();

        // Two levels on is the white night. It is turned to, not jumped to.
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        expect(reactions.level).toBe(3);
        theme.update(1 / 60);
        expect(light.hour.phase).toBeGreaterThan(0);
        expect(light.hour.phase).toBeLessThan(0.05);
        for (let step = 0; step < 300; step++) theme.update(1 / 20);
        const { hour } = reactions.getFrame();
        // The level's two hours and a little of the night's own drift.
        expect(hour).toBeGreaterThan(2);
        expect(hour).toBeLessThan(2.15);
        expect(light.hour.phase).toBeCloseTo(hour, 9);
        const night = SUMMER_HOURS[2];
        expect(light.uSunColor.value.r).toBeLessThan(SUMMER_HOURS[0].sun[0] * 0.65);
        expect(light.uZenith.value.b).toBeLessThan(SUMMER_HOURS[0].zenith[2] * 0.65);
        expect(light.uLamps.value).toBeGreaterThan(night.lamps * 0.9);
        expect(light.uHaze.value).toBeGreaterThan(SUMMER_HOURS[0].haze);
        expect(post.uExposure.value).toBeGreaterThan(post.exposure);
        // The sun has left the ring of the wreath for the hills: lower, and some degrees away.
        expect(light.uSunDir.value.y).toBeLessThan(sunDirection.y);
        expect(THREE.MathUtils.radToDeg(light.uSunDir.value.angleTo(sunDirection))).toBeGreaterThan(2.5);

        // A rebuild (a quality change, or coming back to the theme) takes the night up where it stood.
        const stood = reactions.getNight();
        expect(stood.level).toBe(3);
        theme.disposeRuntime();
        expect(theme.reactions).toBeNull();
        expect(theme.night).toEqual(stood);
        theme.loadAssets.mockResolvedValue(await loadRealAssets());
        await theme.createScene();
        expect(theme.reactions).not.toBe(reactions);
        expect(theme.reactions.getNight()).toEqual(stood);
        expect(theme.reactions.getFrame().hour).toBeCloseTo(hour, 9);
        // Its first frame is already lit by that hour, not by the evening.
        expect(theme.world.light.hour.phase).toBeCloseTo(hour, 9);
        expect(theme.world.light.uLamps.value).toBeGreaterThan(night.lamps * 0.9);
    }, 30000);

    it('draws the Minimal meadow directly, without a pipeline, as its preset says', async () => {
        window.settings.effectQuality = 'Minimal';
        window.location.search = '?forceWebGL=1&summerSeed=99';
        const assets = await loadRealAssets();
        const theme = createTheme();
        theme.isActive = true;
        theme.loadAssets.mockResolvedValue(assets);
        await theme.createScene();
        const {
            renderer, world, post, scene, camera,
        } = theme;
        expect(theme.quality).toBe('Minimal');
        expect(theme.qualityPreset).toBe(QUALITY_PRESETS.Minimal);
        expect(world.tier).toBe(SUMMER_TIERS.Minimal);
        expect(world.petals.sim.count).toBe(QUALITY_PRESETS.Minimal.petalCount);
        expect(world.life.swallows).toBe(QUALITY_PRESETS.Minimal.birdCount);
        expect(world.getDiagnostics().flowers).toBeLessThanOrEqual(QUALITY_PRESETS.Minimal.flowerCount);
        expect(theme.reactions.maxEmitters).toBe(SUMMER_REACTION_LIMITS.Minimal);
        expect(theme.qualityPreset.enablePost).toBe(false);
        expect(post.disabled).toBe(!theme.qualityPreset.enablePost);
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

        // The stands are seeded from the URL, so a capture can be reproduced: the same seed
        // plants the same trees, another seed plants others.
        const placements = world.forest.placements.map((tree) => [tree.asset, tree.x, tree.z]);
        const replant = async (search) => {
            theme.stop();
            window.location.search = search;
            theme.loadAssets.mockResolvedValue(await loadRealAssets());
            theme.isActive = true;
            await theme.createScene(theme.lifecycleGeneration);
            return theme.world.forest.placements.map((tree) => [tree.asset, tree.x, tree.z]);
        };
        expect(await replant('?forceWebGL=1&summerSeed=99')).toEqual(placements);
        expect(await replant('?forceWebGL=1&summerSeed=100')).not.toEqual(placements);
        // No seed, an empty one or a nonsense one all mean the default evening.
        const standard = await replant('?forceWebGL=1');
        expect(await replant('?forceWebGL=1&summerSeed=')).toEqual(standard);
        expect(await replant('?forceWebGL=1&summerSeed=oak')).toEqual(standard);
        expect(await replant('?forceWebGL=1&summerSeed=624')).toEqual(standard);
        // Another theme's seed flag is not this one's.
        expect(await replant('?forceWebGL=1&goldenForestSeed=99')).toEqual(standard);
        expect(standard).not.toEqual(placements);
    }, SLOW);
});
