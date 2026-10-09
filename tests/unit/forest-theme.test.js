import { readFileSync } from 'node:fs';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import ForestTheme, {
    FOREST_POINTER_LEAN, QUALITY_PRESETS, createEmptyForestAssets, readForestEventCount,
} from '../../src/themes/forest/forest-theme.js';
import * as forestAssets from '../../src/themes/forest/forest-assets.js';
import { forestEye, forestViewFor } from '../../src/themes/forest/forest-composition.js';
import { ForestPost } from '../../src/themes/forest/forest-post.js';
import { FOREST_TIERS } from '../../src/themes/forest/forest-quality.js';
import {
    FOREST_REACTION_LIMITS, ForestReactions,
} from '../../src/themes/forest/forest-reactions.js';
import { FOREST_DEFAULT_BOARD } from '../../src/themes/forest/forest-stage.js';
import { FOREST_TETROMINOS } from '../../src/themes/forest/forest-tetrominos.js';
import { ForestWorld } from '../../src/themes/forest/forest-world.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { BaseTheme, setGlobalRenderScale } from '../../src/themes/base-theme.js';
import { getThemeMeta } from '../../src/themes/theme-registry.js';

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
const NO_PACK_WARNING = '[Forest] Asset pack unavailable; drawing the forest without its trees.';
const CONTAINER_ID = 'forest-theme';
const assetDirectory = new URL('../../src/themes/forest/assets/', import.meta.url);
const TIER_ORDER = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
// What the stand-in director hands the world and the lens each frame.
const STUB_FRAME = Object.freeze({ moon: 0.2, shafts: 0.1 });
// Building the real forest takes seconds on a busy machine.
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

function createTheme() {
    const theme = new ForestTheme();
    themes.push(theme);
    vi.spyOn(theme, 'setupGpuResilience').mockImplementation(() => {});
    // No GLB is fetched in this suite: every start receives a stand-in bundle unless a test loads one.
    theme.loadAssets = vi.fn(async () => ({ stub: true }));
    return theme;
}

function stubSceneBuild(theme) {
    vi.spyOn(theme, 'buildScene').mockImplementation(() => {
        theme.scene = new THREE.Scene();
        theme.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 3400);
        theme.camera.position.set(0, 2.1, 13);
        theme.camera.lookAt(-2.2, 5.4, -40);
        theme.world = {
            group: new THREE.Group(),
            update: vi.fn(),
            prepareCamera: vi.fn(),
            setBoard: vi.fn(),
            setLevel: vi.fn(),
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
            getFrame: () => STUB_FRAME,
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
        foliage: { variants: 2, meshes: { spruce_bough_0: { dispose: vi.fn() }, pine_clump_0: { dispose: vi.fn() } } },
        props: { variants: 2, meshes: { log: { dispose: vi.fn() }, stump: { dispose: vi.fn() } } },
        trees: { 'spruce-elder': { bark: { dispose: vi.fn() } }, 'pine-old-a': { bark: { dispose: vi.fn() } } },
        impostors: { tiles: [], texture: { dispose: vi.fn() } },
        moon: { dispose: vi.fn() },
    };
}

function assetDisposals(assets) {
    return [...Object.values(assets.foliage.meshes), ...Object.values(assets.props.meshes),
        ...Object.values(assets.trees).map((tree) => tree.bark), assets.impostors.texture, assets.moon]
        .map((resource) => resource.dispose);
}

/** The real asset pack, parsed from disk; the sprite sheet and the moon are stand-in data textures. */
async function loadRealAssets() {
    const parse = (file) => {
        const bytes = readFileSync(new URL(file, assetDirectory));
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return new GLTFLoader().parseAsync(buffer, '');
    };
    const names = Object.keys(forestAssets.FOREST_TREE_URLS);
    const files = ['forest-foliage.glb', 'forest-props.glb', ...names.map((name) => `${name}.glb`)];
    const [foliage, props, ...trees] = await Promise.all(files.map(parse));
    const assets = {
        foliage: forestAssets.parseForestMeshes(foliage, 'Foliage'),
        props: forestAssets.parseForestMeshes(props, 'Props'),
        trees: {},
        impostors: null,
        moon: new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(200), 4, 4),
    };
    names.forEach((name, index) => {
        assets.trees[name] = forestAssets.parseForestTree(trees[index], name);
    });
    const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4);
    assets.impostors = { ...forestAssets.forestImpostorLayout(), texture };
    return assets;
}

/** Every resource of a real bundle that its owner must release exactly once. */
function realAssetResources(assets) {
    return [...Object.values(assets.foliage.meshes), ...Object.values(assets.props.meshes),
        ...Object.values(assets.trees).map((tree) => tree.bark), assets.impostors.texture, assets.moon];
}

function hexToRgb(hex) {
    return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
}

/** CIE L*a*b* (D65) of a `#rrggbb` colour, for a perceptual distance between two pieces. */
function lab(hex) {
    const [r, g, b] = hexToRgb(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const xyz = [
        (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
        0.2126 * r + 0.7152 * g + 0.0722 * b,
        (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
    ].map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
    return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
}

function colourDistance(a, b) {
    const [first, second] = [lab(a), lab(b)];
    return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

/** Hue in degrees, or null for a grey. */
function hue(hex) {
    const [r, g, b] = hexToRgb(hex);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return null;
    const d = max - min;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return (h * 60 + 360) % 360;
}

/** How many times the theme has said it is drawing the forest without its asset pack. */
function packWarnings() {
    return console.warn.mock.calls.filter(([message]) => message === NO_PACK_WARNING);
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

describe('Forest theme identity and tables', () => {
    it('hands the board its own tetromino palette', () => {
        const theme = createTheme();
        expect(theme.name).toBe('forest');
        expect(theme.resourceProfile).toBe('heavy-gpu');
        const config = theme.getTetrominoConfig();
        expect(config).toBe(FOREST_TETROMINOS);
        expect(Object.keys(config.colors).sort()).toEqual(['GARBAGE', 'I', 'J', 'L', 'O', 'S', 'T', 'Z']);
        for (const colour of Object.values(config.colors)) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
        // Seven pieces the player can tell apart at a glance.
        expect(new Set(Object.values(config.colors)).size).toBe(8);
        expect(config.renderMode).toBe('glow');
        expect(config.version).toBe(1);
        expect(Object.keys(config.rendererOverrides).sort()).toEqual(['canvas', 'phaser']);
        // It is available before the theme has ever started, and unchanged by starting.
        expect(theme.isActive).toBe(false);
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(theme.usesMrtScenePass()).toBe(false);
        // The config has the shape the board's style manager reads, effect by effect.
        for (const key of ['glowRadius', 'glowIntensity', 'outlineWidth', 'pulseSpeed', 'pulseAmplitude',
            'shimmerSpeed', 'shimmerIntensity', 'trailLength', 'trailOpacity']) {
            expect(Number.isFinite(config.effects[key]) && config.effects[key] > 0, key).toBe(true);
        }
        for (const overrides of Object.values(config.rendererOverrides)) {
            for (const [key, value] of Object.entries(overrides)) {
                expect(config.effects, key).toHaveProperty(key);
                expect(Number.isFinite(value) && value > 0, key).toBe(true);
            }
        }
    });

    it('gives the seven pieces colours that read on a dark card and cannot be mistaken for each other', () => {
        const { colors } = FOREST_TETROMINOS;
        const pieces = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
        // The card behind the pieces is near black, and the forest behind the card is deep blue.
        for (const ground of ['#0a1018', '#02040a', '#142238']) {
            for (const piece of pieces) {
                expect(contrast(colors[piece], ground), `${piece} on ${ground}`).toBeGreaterThan(4.5);
            }
        }
        // Garbage is the one dark colour: it recedes instead of competing with the pieces.
        expect(luminance(colors.GARBAGE)).toBeLessThan(0.03);
        for (const piece of pieces) {
            expect(contrast(colors[piece], colors.GARBAGE), `${piece} on garbage`).toBeGreaterThan(4);
        }
        // Every pair is far apart to the eye (CIE76; 2.3 is a just-noticeable difference).
        let nearest = Infinity;
        for (let a = 0; a < pieces.length; a++) {
            for (let b = a + 1; b < pieces.length; b++) {
                const distance = colourDistance(colors[pieces[a]], colors[pieces[b]]);
                expect(distance, `${pieces[a]} against ${pieces[b]}`).toBeGreaterThan(25);
                nearest = Math.min(nearest, distance);
            }
        }
        expect(Number.isFinite(nearest)).toBe(true);
        // The palette is the forest's own: no piece sits in the hue band a falling-block
        // guideline palette would give that shape (scripts/palette-guideline-check.mjs).
        const guideline = {
            I: [[160, 210]],
            O: [[32, 75]],
            T: [[245, 315]],
            S: [[90, 170]],
            Z: [[320, 360], [0, 20]],
            J: [[200, 250]],
            L: [[20, 50]],
        };
        const familiar = pieces.filter((piece) => {
            const degrees = hue(colors[piece]);
            return degrees !== null && guideline[piece].some(([low, high]) => degrees >= low && degrees <= high);
        });
        expect(familiar.length).toBeLessThanOrEqual(3);
    });

    it('is registered under the heavy-GPU lifecycle policy its own profile declares', () => {
        const theme = createTheme();
        expect(theme).toBeInstanceOf(BaseTheme);
        const meta = getThemeMeta('forest');
        expect(meta).toMatchObject({ id: 'forest', module: './forest/forest-theme.js' });
        // ThemeManager overwrites an instance's profile with the registry's, so the two must agree:
        // the long lifecycle timeout and the deep release on deactivation both hang on it.
        expect(meta.resourceProfile).toBe(theme.resourceProfile);
        expect(meta.performanceClass).toBe('heavy');
    });

    it('derives the presets generic readers see from the one tier table', () => {
        const tiers = Object.keys(FOREST_TIERS).sort();
        expect(tiers).toEqual([...TIER_ORDER].sort());
        expect(Object.keys(QUALITY_PRESETS).sort()).toEqual(tiers);
        expect(Object.keys(FOREST_REACTION_LIMITS).sort()).toEqual(tiers);
        expect(Object.isFrozen(QUALITY_PRESETS)).toBe(true);
        for (const quality of tiers) {
            const tier = FOREST_TIERS[quality];
            expect(QUALITY_PRESETS[quality], quality).toEqual({
                fireflyCount: tier.fireflies,
                enablePost: tier.post,
                enablePostProcessing: tier.post,
            });
            expect(Number.isInteger(QUALITY_PRESETS[quality].fireflyCount)).toBe(true);
            expect(QUALITY_PRESETS[quality].fireflyCount).toBeGreaterThan(0);
            expect(Object.isFrozen(QUALITY_PRESETS[quality])).toBe(true);
            const theme = createTheme();
            theme.applyQualityPreset(quality.toLowerCase());
            expect(theme.quality).toBe(quality);
            expect(theme.qualityPreset).toBe(QUALITY_PRESETS[quality]);
        }
        // A cheaper tier never reports more than a dearer one, and the cheapest draws direct.
        for (let index = 1; index < TIER_ORDER.length; index++) {
            const cheaper = QUALITY_PRESETS[TIER_ORDER[index]];
            const dearer = QUALITY_PRESETS[TIER_ORDER[index - 1]];
            expect(cheaper.fireflyCount, TIER_ORDER[index]).toBeLessThanOrEqual(dearer.fireflyCount);
            expect(Number(cheaper.enablePost), TIER_ORDER[index]).toBeLessThanOrEqual(Number(dearer.enablePost));
        }
        expect(QUALITY_PRESETS.Extreme.enablePost).toBe(true);
        expect(QUALITY_PRESETS.Minimal.enablePost).toBe(false);
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
        expect(Object.keys(FOREST_TIERS)).toContain(theme.getCurrentQualityLevel());
    });
});

describe('Forest gameplay payloads', () => {
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
        expect(readForestEventCount(payload, keys, fallback)).toBe(expected);
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

    it('turns the night with the level whatever the effects setting, and back when a run ends', () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        theme.buildScene();
        theme.setupEventListeners();
        eventBus.emit(EVENTS.LEVEL_UP, { level: 4, source: 'odyssey' });
        expect(theme.level).toBe(4);
        expect(theme.world.setLevel).toHaveBeenLastCalledWith(4);
        expect(theme.reactions.onLevelUp).toHaveBeenCalledTimes(1);
        // The bus's other shape, and a level-up that does not say which level: the next one.
        eventBus.emit(EVENTS.LEVEL_UP, { detail: { level: '6' } });
        expect(theme.world.setLevel).toHaveBeenLastCalledWith(6);
        eventBus.emit(EVENTS.LEVEL_UP, {});
        expect(theme.world.setLevel).toHaveBeenLastCalledWith(7);
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2.4 });
        expect(theme.world.setLevel).toHaveBeenLastCalledWith(2);
        // With the effects off the flourish is not played, but a slow change of colour is the
        // theme, not an effect: the night still turns.
        theme.comboEffects = false;
        theme.reactions.onLevelUp.mockClear();
        eventBus.emit(EVENTS.LEVEL_UP, { level: 9 });
        expect(theme.reactions.onLevelUp).not.toHaveBeenCalled();
        expect(theme.world.setLevel).toHaveBeenLastCalledWith(9);
        expect(theme.level).toBe(9);
        // The run ends: the next begins at the first level, and so does the night.
        windowListener('gameOver')();
        expect(theme.level).toBe(1);
        expect(theme.world.setLevel).toHaveBeenLastCalledWith(1);
        // Before there is a world the level is still kept for the one that is coming.
        theme.world = null;
        expect(() => theme.setLevel(5)).not.toThrow();
        expect(theme.level).toBe(5);
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
        // The drop only ever strengthens the lock puff, so it obeys the same setting.
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
        // The envelopes and the fireflies already in flight go together: director and world.
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
        // The forest is put back to sleep even while reactions are switched off.
        theme.comboEffects = false;
        gameOver();
        expect(reactions.onGameOver).toHaveBeenCalledTimes(2);
        theme.stop();
        expect(window.removeEventListener).toHaveBeenCalledWith('gameOver', gameOver, undefined);
        expect(() => gameOver()).not.toThrow();
        expect(reactions.onGameOver).toHaveBeenCalledTimes(2);
    });
});

describe('Forest renderer ownership', () => {
    it('refuses to start without its container, before any renderer exists', async () => {
        document.getElementById = () => null;
        const theme = createTheme();
        theme.isActive = true;
        const build = vi.spyOn(theme, 'buildScene');
        await expect(theme.createScene()).rejects.toThrow('[Forest] Theme container not found.');
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
        await expect(theme.start(shared, {})).rejects.toThrow('[Forest] Theme container not found.');
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
            '[Forest] WebGPU initialization failed; trying node WebGL2.',
            expect.objectContaining({ message: 'native unavailable' }),
        );
        // Same node materials on the fallback backend; only the backend flag differs.
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(container.children).toHaveLength(1);
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
        expect(rendererState.candidates[1].dispose).not.toHaveBeenCalled();
        // The forest is lit through a shadow map on whichever backend it ends up with.
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
        ['?forceWebGL'], ['?forceWebGL=1'], ['?forestForceWebGL=true'], ['?theme=x&forceWebGL=on'],
    ])('honors the %s URL flag without attempting native initialization', async (search) => {
        window.location.search = search;
        await startedTheme();
        expect(rendererState.candidates).toHaveLength(1);
        expect(rendererState.candidates[0].options.forceWebGL).toBe(true);
        expect(rendererState.candidates[0].init).toHaveBeenCalledOnce();
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
        expect(renderer.setClearColor).toHaveBeenCalledExactlyOnceWith(0x02040a, 1);
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
        expect(failure.message).toBe('Forest could not initialize WebGPU or WebGL2.');
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

    // No stop in between: the lifecycle generation is the same for both, so only the runtime
    // generation can tell the superseded start that it no longer owns the theme.
    it('retires a late renderer when a second start was called straight over the first', async () => {
        const pending = deferred();
        rendererState.init = (renderer) => (rendererState.candidates.indexOf(renderer) === 0
            ? pending.promise : Promise.resolve());
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        const first = theme.createScene(theme.lifecycleGeneration);
        await vi.waitFor(() => expect(rendererState.candidates[0]?.init).toHaveBeenCalledOnce());
        await theme.createScene(theme.lifecycleGeneration);
        const activeRenderer = theme.renderer;
        const activeWorld = theme.world;
        expect(activeRenderer).toBe(rendererState.candidates[1]);
        pending.resolve();
        await first;
        // The late renderer is disposed unpublished; the runtime that is up is not touched.
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
        expect(rendererState.candidates[0].setClearColor).not.toHaveBeenCalled();
        expect(activeRenderer.dispose).not.toHaveBeenCalled();
        expect(theme.renderer).toBe(activeRenderer);
        expect(theme.world).toBe(activeWorld);
        expect(activeWorld.dispose).not.toHaveBeenCalled();
        expect(container.children).toEqual([activeRenderer.domElement]);
        expect(liveRafs.size).toBe(1);
        expect(theme.loadAssets).toHaveBeenCalledOnce();
        expect(theme.buildScene).toHaveBeenCalledOnce();
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(1);
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

describe('Forest runtime disposal', () => {
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
        expect(window.__FOREST__).toBe(theme);
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
            .toBeLessThan(bundle.trees['spruce-elder'].bark.dispose.mock.invocationCallOrder[0]);
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
        expect(window.__FOREST__).toBeUndefined();
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
            .toBeLessThan(bundle.trees['spruce-elder'].bark.dispose.mock.invocationCallOrder[0]);
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
        world.dispose.mockImplementation(() => { throw new Error('forest stuck'); });
        expect(() => theme.disposeRuntime()).not.toThrow();
        expect(console.warn).toHaveBeenCalledWith('[Forest] Post disposal failed.', expect.any(Error));
        expect(console.warn).toHaveBeenCalledWith('[Forest] World disposal failed.', expect.any(Error));
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

describe('Forest asset loading', () => {
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

    // Forest is what the game falls back to when another theme fails, so a pack that cannot be
    // loaded must not take the background with it: the forest is grown from an empty bundle.
    it.each([
        ['rejects', (failure) => () => Promise.reject(failure), new Error('offline')],
        ['throws before it has even started', (failure) => () => { throw failure; }, new Error('bad manifest')],
        ['rejects with something that is not an Error', (failure) => () => Promise.reject(failure), 404],
    ])('starts without its trees when the loader %s, and asks for the pack again next time', async (
        _label,
        failing,
        failure,
    ) => {
        const theme = createTheme();
        stubSceneBuild(theme);
        const builtFrom = [];
        const buildScene = theme.buildScene.getMockImplementation();
        theme.buildScene.mockImplementation(() => {
            builtFrom.push({ assets: theme.assets, missing: theme.assetPackMissing });
            buildScene();
        });
        const shared = { loadTheme: vi.fn() };
        const bundle = stubAssets();
        theme.loadAssets.mockImplementationOnce(failing(failure)).mockResolvedValue(bundle);
        expect(theme.assetPackMissing).toBe(false);
        await expect(theme.start(shared, {})).resolves.toBeUndefined();
        // It is running like any other start: renderer, artwork, listeners and a frame loop.
        expect(theme.lifecycleState).toBe('running');
        expect(theme.isActive).toBe(true);
        expect(theme.buildScene).toHaveBeenCalledOnce();
        expect(theme.renderer).toBe(rendererState.candidates[0]);
        expect(theme.renderer.dispose).not.toHaveBeenCalled();
        expect(container.children).toEqual([theme.renderer.domElement]);
        expect(liveRafs.size).toBe(1);
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(1);
        // It says so once, with the reason, and remembers it for whoever inspects the theme.
        expect(packWarnings()).toEqual([[NO_PACK_WARNING, failure]]);
        expect(theme.assetPackMissing).toBe(true);
        // The world was handed the empty bundle, shaped like a real one with nothing in it.
        const empty = theme.assets;
        expect(builtFrom).toEqual([{ assets: empty, missing: true }]);
        expect(empty).toEqual({
            trees: {}, foliage: { variants: 2, meshes: {} }, props: { meshes: {} }, impostors: null, moon: null,
        });
        expect(empty).toEqual(createEmptyForestAssets());
        // The game still plays the forest it has.
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2 });
        expect(theme.reactions.onLineClear).toHaveBeenCalledExactlyOnceWith(2, { lineCount: 2 });

        // Nothing is remembered between starts: the next one asks again and gets its trees.
        await theme.start(shared, {});
        expect(theme.lifecycleState).toBe('running');
        expect(theme.loadAssets).toHaveBeenCalledTimes(2);
        expect(theme.assets).toBe(bundle);
        expect(theme.assetPackMissing).toBe(false);
        expect(builtFrom[1]).toEqual({ assets: bundle, missing: false });
        expect(packWarnings()).toHaveLength(1);
        expect(theme.renderer).toBe(rendererState.candidates[1]);
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
        expect(container.children).toEqual([theme.renderer.domElement]);
        expect(liveRafs.size).toBe(1);
        theme.cleanup();
        assetDisposals(bundle).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
        expect(theme.assetPackMissing).toBe(false);
    });

    it('makes a new empty bundle for every start that needs one', async () => {
        expect(createEmptyForestAssets()).not.toBe(createEmptyForestAssets());
        expect(createEmptyForestAssets().trees).not.toBe(createEmptyForestAssets().trees);
        expect(createEmptyForestAssets().foliage.meshes).not.toBe(createEmptyForestAssets().foliage.meshes);
        // The asset module releases it like any other bundle.
        expect(() => forestAssets.disposeForestAssets(createEmptyForestAssets())).not.toThrow();
        const theme = createTheme();
        stubSceneBuild(theme);
        theme.loadAssets.mockRejectedValue(new Error('offline'));
        const shared = { loadTheme: vi.fn() };
        await theme.start(shared, {});
        const first = theme.assets;
        await theme.start(shared, {});
        expect(theme.assets).toEqual(first);
        expect(theme.assets).not.toBe(first);
        // Each start that had to do without says so; neither failed.
        expect(packWarnings()).toHaveLength(2);
        expect(theme.lifecycleState).toBe('running');
        // Stopping forgets the state along with the runtime.
        theme.stop();
        expect(theme.assetPackMissing).toBe(false);
        expect(theme.assets).toBeNull();
    });

    it('does not conjure a treeless forest for a start that was stopped while its load was failing', async () => {
        const pending = deferred();
        const theme = createTheme();
        theme.isActive = true;
        theme.loadAssets.mockReturnValue(pending.promise);
        const build = vi.spyOn(theme, 'buildScene');
        const start = theme.createScene().catch((error) => error);
        await vi.waitFor(() => expect(theme.loadAssets).toHaveBeenCalledOnce());
        const [renderer] = rendererState.candidates;
        theme.stop();
        pending.reject(new Error('late 404'));
        // The stopped start reports its own failure; nobody is told the forest lost its trees.
        expect((await start).message).toBe('late 404');
        expect(packWarnings()).toEqual([]);
        expect(build).not.toHaveBeenCalled();
        expect(theme.assetPackMissing).toBe(false);
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(container.children).toHaveLength(0);
        for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
        expect(rafs).toHaveLength(0);
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(0);
    });

    it('still fails the start when the treeless forest cannot be built either', async () => {
        const theme = createTheme();
        const shared = { loadTheme: vi.fn() };
        theme.loadAssets.mockRejectedValue(new Error('offline'));
        vi.spyOn(theme, 'buildScene').mockImplementation(() => { throw new Error('shader graph exploded'); });
        await expect(theme.start(shared, {})).rejects.toThrow('shader graph exploded');
        expect(theme.lifecycleState).toBe('failed');
        expect(theme.isActive).toBe(false);
        expect(packWarnings()).toHaveLength(1);
        expect(theme.assetPackMissing).toBe(false);
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
        expect(container.children).toHaveLength(0);
        expect(liveRafs.size).toBe(0);
        expect(theme.eventUnsubscribers).toEqual([]);
        for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
        for (const event of GAMEPLAY_EVENTS) expect(eventBus.listenerCount(event)).toBe(0);
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
        // The stale start still reports its own failure to whoever awaited it, and does not
        // rebuild the newer runtime's forest without its trees.
        expect((await first).message).toBe('late 404');
        expect(packWarnings()).toEqual([]);
        expect(theme.buildScene).toHaveBeenCalledOnce();
        expect(theme.assetPackMissing).toBe(false);
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
        const load = vi.spyOn(forestAssets, 'loadForestAssets').mockResolvedValue(bundle);
        const theme = new ForestTheme();
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

describe('Forest board tracking and camera', () => {
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
        expect(world.update).toHaveBeenCalledExactlyOnceWith(1 / 60, 1 / 60, STUB_FRAME);
        // The lens reads the director's own frame (its `moon` and `shafts`), not a copy.
        expect(post.update).toHaveBeenCalledExactlyOnceWith(STUB_FRAME);
        expect(post.update.mock.calls[0][0]).toBe(world.update.mock.calls[0][2]);
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
        // Half a metre at most: parallax, not a camera move. The rest pose itself never drifts.
        expect(Object.isFrozen(FOREST_POINTER_LEAN)).toBe(true);
        for (const lean of [FOREST_POINTER_LEAN.x, FOREST_POINTER_LEAN.y]) {
            expect(lean).toBeGreaterThan(0.05);
            expect(lean).toBeLessThanOrEqual(0.5);
        }
        expect(camera.position.x - rest.x).toBeCloseTo(FOREST_POINTER_LEAN.x, 2);
        expect(camera.position.y - rest.y).toBeCloseTo(FOREST_POINTER_LEAN.y, 2);
        expect(camera.position.z).toBe(rest.z);
        expect(theme.restPosition.equals(rest)).toBe(true);
        // The view leans with the eye instead of pivoting: it still looks down the same ride.
        const leaning = camera.getWorldDirection(new THREE.Vector3());
        const resting = theme.restTarget.clone().sub(rest).normalize();
        expect(leaning.angleTo(resting)).toBeLessThan(THREE.MathUtils.degToRad(1));
        // It eases there rather than jumping.
        move({ clientX: 0, clientY: 900, pointerType: 'mouse' });
        theme.update(1 / 60);
        expect(camera.position.x - rest.x).toBeGreaterThan(FOREST_POINTER_LEAN.x * 0.8);
        expect(camera.position.x - rest.x).toBeLessThan(FOREST_POINTER_LEAN.x);
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
        world.prepareCamera.mockImplementation(() => {
            camera.position.set(1.5, 2.6, 15.5);
            camera.lookAt(-14.5, 11.5, -36);
        });
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 390, height: 844 });
        expect(renderer.setSize).toHaveBeenLastCalledWith(390, 844);
        expect(post.setSize).toHaveBeenLastCalledWith(390, 844);
        expect(world.prepareCamera).toHaveBeenLastCalledWith(390 / 844);
        expect(camera.aspect).toBe(390 / 844);
        expect(theme.restPosition.toArray()).toEqual([1.5, 2.6, 15.5]);
        // The rest target lies along the line of sight the world chose, so the next frame's
        // camera update leaves that framing exactly as it was.
        const sight = new THREE.Vector3(-14.5, 11.5, -36).sub(theme.restPosition).normalize();
        expect(theme.restTarget.clone().sub(theme.restPosition).normalize().distanceTo(sight)).toBeLessThan(1e-9);
        const framed = camera.quaternion.clone();
        theme.update(1 / 60);
        expect(camera.position.toArray()).toEqual([1.5, 2.6, 15.5]);
        expect(camera.quaternion.angleTo(framed)).toBeLessThan(1e-6);
        // Nonsense sizes fall back to the window's own.
        for (const [width, height] of [[0, 0], [-5, 100], [NaN, NaN], [undefined, undefined]]) {
            theme.resize(width, height);
        }
        expect(renderer.setSize).toHaveBeenLastCalledWith(1440, 900);
        expect(renderer.setSize).toHaveBeenCalledTimes(3);
    });
});

describe('Forest cadence, pause and quality changes', () => {
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
        expect(theme.world.update).toHaveBeenCalledExactlyOnceWith(0.05, 0.05, STUB_FRAME);
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
        // Gameplay does not reach a paused forest.
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
        expect(error).toHaveBeenCalledExactlyOnceWith('[Forest] Render failed.', failure);
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
        // Settings that are not about quality never rebuild the forest.
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
    // load decides the tier the forest is built at.
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
        expect(world.update).toHaveBeenCalledExactlyOnceWith(0, 0, STUB_FRAME);
        expect(liveRafs.size).toBe(1);
    });
});

describe('Forest with its real artwork', () => {
    it('wires the loaded pack into forest, lens and director, and plays a session through the bus', async () => {
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
        expect(world).toBeInstanceOf(ForestWorld);
        expect(world.assets).toBe(assets);
        expect(world.quality).toBe('High');
        expect(world.built).toBe(true);
        expect(world.scene).toBe(scene);
        expect(world.camera).toBe(camera);
        expect(scene.children).toEqual([world.group]);
        expect(theme.getWarmupRoots()).toEqual([world.group]);
        expect(reactions).toBeInstanceOf(ForestReactions);
        expect(reactions.quality).toBe('High');
        expect(reactions.maxEmitters).toBe(FOREST_REACTION_LIMITS.High);
        // The lens marches its beams through the forest's own moon.
        expect(post).toBeInstanceOf(ForestPost);
        expect(post.light).toBe(world.light);
        expect(post.renderer).toBe(renderer);
        const lens = post.getDiagnostics();
        expect(lens).toEqual({
            quality: 'High',
            disabled: !QUALITY_PRESETS.High.enablePost,
            useMRT: false,
            godrays: FOREST_TIERS.High.post && FOREST_TIERS.High.godrays > 0,
        });
        expect(renderer.shadowMap.enabled).toBe(true);
        // The beams read the moon's shadow map, which one priming render of the scene builds.
        expect(renderer.render.mock.calls).toEqual(lens.godrays ? [[scene, camera]] : []);
        expect(world.getDiagnostics().trees).toBeGreaterThan(8);
        expect(world.fireflies.sim.count).toBe(QUALITY_PRESETS.High.fireflyCount);
        // Framed by the world for this window, and the theme rests exactly there.
        const view = forestViewFor(1440 / 900);
        expect(camera.aspect).toBe(1440 / 900);
        expect(camera.fov).toBe(view.fov);
        expect(camera.near).toBeGreaterThan(0);
        expect(camera.far).toBeGreaterThan(camera.near * 1000);
        expect(camera.position.toArray()).toEqual(forestEye(view));
        expect(theme.restPosition.equals(camera.position)).toBe(true);
        const towards = new THREE.Vector3(...view.target).sub(camera.position).normalize();
        expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(towards)).toBeLessThan(1e-6);
        expect(theme.restTarget.clone().sub(theme.restPosition).normalize().distanceTo(towards)).toBeLessThan(1e-6);
        expect(world.stage.board).toEqual(FOREST_DEFAULT_BOARD);
        expect(post.uAspect.value).toBe(1440 / 900);
        const resting = {
            shafts: post.uShafts.value, exposure: post.uExposure.value, moon: world.light.uMoonGain.value,
        };

        // A short session through the real bus.
        const piece = { x: 1, y: 20, shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] };
        const { sim } = world.fireflies;
        const { pulses } = world.light;
        expect(sim.counts()).toMatchObject({ live: 0, bound: 0 });
        expect(pulses.active()).toBe(0);
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
        expect(kinds).toEqual(expect.arrayContaining(['lock', 'clear', 'rise', 'combo', 'spin']));
        // The cleared rows blow fireflies out of both sides of the card.
        expect(frame.emitters.filter((emitter) => emitter.kind === 'clear').map((emitter) => emitter.side).sort())
            .toEqual([-1, 1]);
        // The piece landed left of the middle, so its puff leaves the card's left edge.
        expect(frame.emitters.find((emitter) => emitter.kind === 'lock')).toMatchObject({ side: -1 });
        expect(frame.emitters.length).toBeLessThanOrEqual(FOREST_REACTION_LIMITS.High);
        expect(frame.front).not.toBeNull();
        // Four lines call the fireflies together, and several waves of light are waiting to go out.
        expect(frame.figure).toMatchObject({ held: true });
        expect(frame.stars).toBeGreaterThan(0);
        expect(frame.waves.filter((wave) => wave.serial >= 0).length).toBeGreaterThanOrEqual(5);
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
        expect(sim.time).toBeCloseTo(0.75, 9);
        // The forest answered: sparks in the air, the figure gathering, waves on the floor, wind,
        // a brighter moon, a waking wood, and stronger beams through the lens.
        expect(sim.counts().live).toBeGreaterThan(100);
        expect(sim.counts().bound).toBeGreaterThan(0);
        expect(sim.outPlace.every(Number.isFinite)).toBe(true);
        expect(sim.outGlow.every(Number.isFinite)).toBe(true);
        expect(pulses.active()).toBeGreaterThan(0);
        expect(pulses.active()).toBeLessThanOrEqual(FOREST_TIERS.High.pulses);
        expect(world.light.uGust.value).toBeGreaterThan(0);
        expect(world.light.uWake.value).toBeGreaterThan(0);
        expect(world.light.uMoonGain.value).toBeGreaterThan(resting.moon);
        expect(world.terrain.uThreads.value).toBeGreaterThan(0);
        expect(post.uShafts.value).toBeGreaterThan(resting.shafts);
        expect(post.uExposure.value).toBeGreaterThan(resting.exposure);
        expect(world.getDiagnostics()).toMatchObject({ fireflies: sim.counts(), pulses: pulses.active() });

        // Game over puts the forest back to sleep; switching effects off empties the air at once.
        windowListener('gameOver')();
        expect(reactions.getFrame().front).toBeNull();
        expect(reactions.getFrame().settled).toBe(true);
        expect(reactions.getFrame().figure?.held ?? false).toBe(false);
        expect(reactions.getFrame().emitters.length).toBeGreaterThan(0);
        theme.update(1 / 60);
        expect(world.director.env.settled).toBe(true);
        expect(sim.counts().bound).toBe(0);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { changed: { backgroundComboEffects: false } });
        expect(reactions.getFrame().emitters).toEqual([]);
        expect(reactions.getFrame().figure).toBeNull();
        expect(sim.counts()).toMatchObject({ live: 0, bound: 0 });
        expect(pulses.active()).toBe(0);
        // With effects off the game no longer reaches the forest.
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4 });
        theme.update(1 / 60);
        expect(sim.counts().live).toBe(0);
        expect(pulses.active()).toBe(0);
        // Switched back on, the next lock is the first event of a new epoch, numbered from
        // zero like the first lock of the session before it: it must not be taken for that one.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { changed: { backgroundComboEffects: true } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece });
        expect(reactions.getFrame().emitters.map((emitter) => emitter.serial)).toEqual([0]);
        theme.update(1 / 60);
        expect(reactions.getFrame().epoch).toBe(2);
        expect(world.director.epoch).toBe(2);
        expect(sim.counts().live).toBeGreaterThan(0);
        expect(pulses.active()).toBe(1);

        const disposals = realAssetResources(assets).map((resource) => vi.spyOn(resource, 'dispose'));
        theme.stop();
        expect(world.disposed).toBe(true);
        expect(post.disposed).toBe(true);
        expect(reactions.disposed).toBe(true);
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(scene.children).toHaveLength(0);
        for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
    }, SLOW);

    it('draws the Minimal forest directly, without a pipeline, as its preset says', async () => {
        window.settings.effectQuality = 'Minimal';
        window.location.search = '?forceWebGL=1&forestSeed=99';
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
        expect(world.tier).toBe(FOREST_TIERS.Minimal);
        expect(world.fireflies.sim.count).toBe(QUALITY_PRESETS.Minimal.fireflyCount);
        expect(theme.reactions.maxEmitters).toBe(FOREST_REACTION_LIMITS.Minimal);
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

        // The grove is seeded from the URL, so a capture can be reproduced: the same seed
        // plants the same trees, another seed plants others.
        const planted = () => theme.world.trees.placements.map((tree) => [tree.asset, tree.x, tree.z]);
        const placements = planted();
        const replant = async (search) => {
            theme.stop();
            window.location.search = search;
            theme.loadAssets.mockResolvedValue(await loadRealAssets());
            theme.isActive = true;
            await theme.createScene(theme.lifecycleGeneration);
            return planted();
        };
        expect(await replant('?forceWebGL=1&forestSeed=99')).toEqual(placements);
        expect(await replant('?forceWebGL=1&forestSeed=100')).not.toEqual(placements);
        // No seed, an empty one or a nonsense one all mean the default grove.
        const standard = await replant('?forceWebGL=1');
        expect(await replant('?forceWebGL=1&forestSeed=')).toEqual(standard);
        expect(await replant('?forceWebGL=1&forestSeed=oak')).toEqual(standard);
        expect(standard).not.toEqual(placements);

        // The forest is the same forest every night, but which animal answers four lines is
        // left to chance in the game; a seed in the URL makes that part of the night
        // repeatable too.
        await replant('?forceWebGL=1');
        expect(theme.reactions.rng).not.toBe(Math.random);
        expect(theme.reactions.figureRng).toBe(Math.random);
        await replant('?forceWebGL=1&forestSeed=');
        expect(theme.reactions.figureRng).toBe(Math.random);
        await replant('?forceWebGL=1&forestSeed=99');
        expect(theme.reactions.figureRng).toBe(theme.reactions.rng);

        // The hour of the night belongs to the game being played: a forest that is built
        // again (another quality tier, a lost device) is in that hour at once.
        expect(theme.world.level).toBe(1);
        expect(theme.world.hourStep).toBe(0);
        theme.setLevel(4);
        expect(theme.world.level).toBe(4);
        expect(theme.world.hourStep).toBe(0);
        // Two and a half hours of the night go by on this forest's clock.
        // (This forest already took up the moment the ones before it had lived.)
        const before = theme.world.nightStart;
        theme.time = 300;
        theme.update(0);
        expect(theme.nightLived).toBeCloseTo(before + 300, 9);
        const hourBefore = theme.world.light.hourPhase;
        await replant('?forceWebGL=1&forestSeed=99');
        expect(theme.world.level).toBe(4);
        expect(theme.world.hourStep).toBe(-2);
        // Its own clock starts again; the night does not.
        expect(theme.time).toBe(0);
        expect(theme.world.nightStart).toBeCloseTo(before + 300, 9);
        expect(theme.world.light.hourPhase).toBeCloseTo(hourBefore - 2, 9);
        expect(theme.world.getDiagnostics().hour).toBe('deep night');
    }, SLOW);

    it('frames an upright screen from the first build, before any resize has been heard', async () => {
        window.settings.effectQuality = 'Minimal';
        window.innerWidth = 390;
        window.innerHeight = 844;
        const theme = createTheme();
        theme.isActive = true;
        theme.loadAssets.mockResolvedValue(await loadRealAssets());
        const prepare = vi.spyOn(ForestWorld.prototype, 'prepareCamera');
        await theme.createScene();
        const { camera, world, renderer } = theme;
        const view = forestViewFor(390 / 844);
        expect(view).not.toBe(forestViewFor(16 / 9));
        // The world never framed this phone as a landscape screen on the way.
        expect(prepare.mock.calls.length).toBeGreaterThan(0);
        for (const [aspect] of prepare.mock.calls) expect(aspect).toBe(390 / 844);
        expect(camera.aspect).toBe(390 / 844);
        expect(camera.fov).toBe(view.fov);
        expect(camera.position.toArray()).toEqual(forestEye(view));
        expect(theme.restPosition.equals(camera.position)).toBe(true);
        expect(renderer.setSize).toHaveBeenCalledExactlyOnceWith(390, 844);
        // The stage was read from that framing: the card's centre projects back onto the card.
        const centre = world.stage.centre().project(camera);
        expect(centre.x).toBeCloseTo((FOREST_DEFAULT_BOARD.x0 + FOREST_DEFAULT_BOARD.x1) - 1, 6);
        expect(centre.y).toBeCloseTo(1 - (FOREST_DEFAULT_BOARD.y0 + FOREST_DEFAULT_BOARD.y1), 6);
    }, SLOW);

    // The last resort: the real world, lens and director, grown from nothing but the empty bundle.
    it.each(['High', 'Minimal'])('grows a %s forest without trees when the pack cannot be loaded, and plays it', async (
        quality,
    ) => {
        window.settings.effectQuality = quality;
        const failure = new Error('ERR_FILE_NOT_FOUND');
        const theme = createTheme();
        theme.loadAssets.mockRejectedValue(failure);
        await expect(theme.start({ loadTheme: vi.fn() }, {})).resolves.toBeUndefined();
        expect(theme.lifecycleState).toBe('running');
        expect(packWarnings()).toEqual([[NO_PACK_WARNING, failure]]);
        expect(theme.assetPackMissing).toBe(true);
        const {
            world, post, reactions, scene, renderer,
        } = theme;
        expect(theme.quality).toBe(quality);
        expect(world).toBeInstanceOf(ForestWorld);
        expect(world.built).toBe(true);
        expect(world.assets).toBe(theme.assets);
        expect(world.assets).toEqual(createEmptyForestAssets());
        expect(scene.children).toEqual([world.group]);
        expect(post).toBeInstanceOf(ForestPost);
        expect(post.disabled).toBe(!QUALITY_PRESETS[quality].enablePost);
        // No trees and nothing that is cut from the pack; the night, the floor and the fireflies are all there.
        const diagnostics = world.getDiagnostics();
        expect(diagnostics).toMatchObject({
            quality, trees: 0, sprays: 0, farTrees: 0,
        });
        expect(world.fireflies.sim.count).toBe(QUALITY_PRESETS[quality].fireflyCount);
        const drawn = [];
        world.group.traverse((object) => { if (object.isMesh) drawn.push(object.name); });
        expect(drawn.length).toBeGreaterThan(4);
        expect(drawn.some((name) => /bark|foliage/i.test(name))).toBe(false);
        for (const mesh of world.group.children.flatMap((group) => group.children).filter((object) => object.isMesh)) {
            expect(mesh.geometry.attributes.position.count).toBeGreaterThan(0);
        }

        // A whole move of the game, through the real bus: the forest answers with what it has.
        const piece = { x: 4, y: 20, shape: [[1, 1], [1, 1]] };
        const { sim } = world.fireflies;
        eventBus.emit(EVENTS.HARD_DROP, { piece, distance: 16 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [20, 21, 22, 23] });
        eventBus.emit(EVENTS.COMBO, { comboCount: 5 });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 1 });
        if (post.pipeline) vi.spyOn(post.pipeline, 'render').mockImplementation(() => {});
        expect(() => {
            for (let step = 0; step < 45; step++) {
                theme.update(1 / 60);
                theme.renderFrame();
            }
        }).not.toThrow();
        expect(reactions.time).toBeCloseTo(0.75, 9);
        expect(sim.counts().live).toBeGreaterThan(0);
        expect(sim.counts().bound).toBeGreaterThan(0);
        expect(world.light.pulses.active()).toBeGreaterThan(0);
        expect(sim.outPlace.every(Number.isFinite)).toBe(true);
        expect(sim.outGlow.every(Number.isFinite)).toBe(true);
        expect(world.light.uWake.value).toBeGreaterThan(0);

        theme.stop();
        expect(world.disposed).toBe(true);
        expect(post.disposed).toBe(true);
        expect(scene.children).toHaveLength(0);
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(theme.assetPackMissing).toBe(false);
        for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
    }, SLOW);
});
