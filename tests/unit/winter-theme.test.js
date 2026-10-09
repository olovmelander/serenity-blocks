/* eslint-disable max-classes-per-file */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import WinterTheme from '../../src/themes/winter/winter-theme.js';
import { WINTER_TETROMINOS } from '../../src/themes/winter/winter-tetrominos.js';
import {
    WINTER_PARTS, WinterWorld, REST_RIG, fovForAspect,
} from '../../src/themes/winter/winter-world.js';
import { POST_LOOK } from '../../src/themes/winter/winter-post.js';
import { EYE, HOURS } from '../../src/themes/winter/winter-core.js';
import { QUALITY_NAMES } from '../../src/themes/winter/winter-quality.js';
import { WINTER_EVENT_HANDLERS } from '../../src/themes/winter/winter-director.js';
import { BaseTheme } from '../../src/themes/base-theme.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';
import { THEME_URL_PARAMETERS } from '../../src/ui/url-parameters/theme-parameters.js';
import { FLAG_REGISTRY } from '../../src/core/flags.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const themeDir = path.join(repoRoot, 'src', 'themes', 'winter');

/**
 * What the theme it replaces was made of, and nothing of the new one is: the storm director and
 * its overlay, the light rig, the post pipeline, the snow simulation, the fox, its paw trails and
 * the trees as they were, the scene's materials and GLSL, and the conifer models the baked snow
 * ghosts stand in for now.
 */
const RETIRED = [
    'composition', 'lighting', 'post', 'rendering', 'sim', 'winter-materials.js', 'winter-shaders.js',
    'assets/fir.glb', 'assets/pine.glb', 'assets/pine_lod.glb', 'assets/spruce.glb', 'assets/spruce_lod.glb',
];
/** The flags the old theme read from the URL. */
const RETIRED_FLAGS = [
    'winterMrtAudit', 'winterBaseline', 'winterStorm', 'winterNoPost', 'winterNoFlakes', 'winterNoStars',
    'winterNoSnow', 'winterBare', 'winterLegacy',
];

const mocks = vi.hoisted(() => ({
    initialize: null, instances: [], failPipelines: 0, surfaces: [], loadGhosts: null, ghosts: null, fullBake: false,
}));
// Nearly every test builds a world; on a machine busy with other work one build can take seconds.
vi.setConfig({ testTimeout: 30000 });
/** The tests that build the world as it ships (see the winter-field mock) get this long. */
const FULL_BAKE_TIMEOUT_MS = 60000;
vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        RenderPipeline: class {
            constructor() {
                if (mocks.failPipelines > 0) {
                    mocks.failPipelines -= 1;
                    throw new Error('pipeline unavailable');
                }
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
                this.pixelRatio = 1;
                this.size = { width: 1280, height: 720 };
                this.setClearColor = vi.fn();
                this.setPixelRatio = vi.fn((ratio) => { this.pixelRatio = ratio; });
                this.getPixelRatio = () => this.pixelRatio;
                this.setSize = vi.fn((width, height) => { this.size = { width, height }; });
                this.getDrawingBufferSize = (target) => target.set(
                    Math.floor(this.size.width * this.pixelRatio),
                    Math.floor(this.size.height * this.pixelRatio),
                );
                this.render = vi.fn();
                this.compute = vi.fn();
                this.init = vi.fn(async () => mocks.initialize?.(this));
                mocks.instances.push(this);
            }
        },
    };
});
// The viewport broadcaster keeps the first window it saw; every test here stubs a new one.
vi.mock('../../src/utils/viewport.js', async (importOriginal) => ({
    ...(await importOriginal()),
    getViewport: () => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }),
}));
vi.mock('../../src/utils/gpu-loss-coordinator.js', () => ({
    initGpuLossCoordinator: vi.fn(),
    registerGpuSurface: (label, surface) => {
        const registration = { label, surface, unregister: vi.fn() };
        mocks.surfaces.push(registration);
        return registration.unregister;
    },
}));
// The fox's model is never fetched here: the world does without its body (its mind, its prints
// and its sparks need none).
vi.mock('../../src/themes/winter/winter-fox.js', async (importOriginal) => ({
    ...(await importOriginal()),
    loadFox: async () => null,
}));
// The baked snow ghosts are a binary: nothing fetches one here. The turned stand-ins take their
// place, and each test decides when they arrive and what they claim to be.
vi.mock('../../src/themes/winter/winter-ghosts.js', async (importOriginal) => {
    const actual = await importOriginal();
    let plan = null;
    mocks.ghosts = (source = 'asset') => {
        plan ??= actual.planGhosts();
        return { ...plan, source };
    };
    return { ...actual, loadGhosts: (...args) => mocks.loadGhosts(...args) };
});
// The ground's fan and the trees' moon shadows are CPU bakes that grow with the tier: seconds
// of work for a whole world on a busy machine, and nearly every test here builds one. A coarse
// fan and an unshadowed mask stand in for them, except where a test sets `mocks.fullBake`: the
// ones that build each tier build what ships.
vi.mock('../../src/themes/winter/winter-field.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        buildGroundFan: (size, ...rest) => actual.buildGroundFan(mocks.fullBake ? size : [24, 16], ...rest),
        bakeMoonShadows: (trees, ghosts, moon, size, ...rest) => (mocks.fullBake
            ? actual.bakeMoonShadows(trees, ghosts, moon, size, ...rest)
            : new Uint8Array(size * size).fill(255)),
    };
});

const owners = [];
function createTheme() {
    const theme = new WinterTheme();
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

/** A DOM element double with a rect (CSS px). */
const box = (left, top, width, height) => ({
    getBoundingClientRect: () => ({
        left, top, right: left + width, bottom: top + height, width, height,
    }),
});

/** A promise a test settles when it chooses. */
function deferred() {
    let resolve = null;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

/** A game-mode manager double: what it was asked to tell the theme, and how to tell it. */
function modeManager() {
    const manager = { handlers: new Map(), off: vi.fn() };
    manager.on = vi.fn((name, handler) => {
        manager.handlers.set(name, handler);
        return manager.off;
    });
    return manager;
}

function stubBrowser({
    gpu = false, search = '', quality = 'Low', reducedMotion = false, settings = {},
} = {}) {
    const listeners = new Map();
    const container = {
        replaceChildren: vi.fn(),
        appendChild: vi.fn(),
        classList: { add: vi.fn(), remove: vi.fn() },
        style: { removeProperty: vi.fn() },
    };
    // What the layout watch finds on screen: nothing, until a test puts a board there.
    const page = { cards: [], canvas: null, hud: null };
    const win = {
        innerWidth: 1280,
        innerHeight: 720,
        devicePixelRatio: 1,
        location: { search },
        settings: { effectQuality: quality, graphicsQuality: quality, ...settings },
        addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
        removeEventListener: vi.fn(),
        matchMedia: () => ({ matches: reducedMotion, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', {
        getElementById: (id) => (id === 'winter-theme' ? container : null),
        querySelector: (selector) => {
            if (selector === '#main-game-canvas') return page.canvas;
            if (selector === '.single-player-stats-bar') return page.hud;
            return null;
        },
        querySelectorAll: (selector) => (selector === '.player-card[data-player]' ? page.cards : []),
    });
    vi.stubGlobal('navigator', gpu ? { gpu: {}, userAgent: 'Linux' } : {});
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    return {
        container, listeners, page, win,
    };
}

async function startTheme(options) {
    const browser = stubBrowser(options);
    const theme = createTheme();
    await theme.createScene(theme.lifecycleGeneration);
    return { theme, ...browser };
}

/** Run `frames` frames of 1/60 s from the theme's last frame time. */
function stepFrames(theme, frames) {
    let now = theme.lastFrameMs ?? 0;
    for (let i = 0; i < frames; i++) {
        now += 1000 / 60;
        theme.stepFrame(now);
    }
}

/** Watch what the theme hands its world. */
function watchWorld(world) {
    return {
        lock: vi.spyOn(world, 'onLock'),
        clear: vi.spyOn(world, 'onClear'),
        combo: vi.spyOn(world, 'onCombo'),
        levelUp: vi.spyOn(world, 'levelUp'),
        gameOver: vi.spyOn(world, 'onGameOver'),
        reset: vi.spyOn(world, 'resetSession'),
    };
}

const T = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
};
const I = {
    shape: [[1, 1, 1, 1]], x: 6, y: 23, type: 'I',
};

/** The pixel-ratio cap each quality tier renders under (the render scale and DPR still apply). */
const PIXEL_RATIO_CAPS = [
    ['Minimal', 0.7], ['Low', 0.85], ['Medium', 1.0], ['High', 1.15], ['Ultra', 1.35], ['Extreme', 1.6],
];

beforeEach(() => {
    mocks.initialize = null;
    mocks.instances.length = 0;
    mocks.surfaces.length = 0;
    mocks.failPipelines = 0;
    mocks.fullBake = false;
    mocks.loadGhosts = vi.fn(async () => mocks.ghosts('asset'));
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

describe('Winter theme: what ships', () => {
    it('is registered under its id with its own icon', () => {
        const entry = THEME_REGISTRY.find(({ id }) => id === 'winter');
        expect(entry).toMatchObject({
            displayName: 'Winter',
            module: './winter/winter-theme.js',
            icon: './winter/winter-theme-icon.png',
        });
        expect(existsSync(path.join(themeDir, 'winter-theme-icon.png'))).toBe(true);
        const theme = new WinterTheme();
        expect(theme.name).toBe('winter');
        expect(theme).toBeInstanceOf(BaseTheme);
    });

    it('hands the board its own palette: a colour for every shape, no two alike', () => {
        expect(new WinterTheme().getTetrominoConfig()).toBe(WINTER_TETROMINOS);
        // (The values are read from the module, not pinned: the sky is painted with them, and
        // they are tuned with it.)
        expect(WINTER_TETROMINOS.version).toBe(1);
        expect(Object.keys(WINTER_TETROMINOS.colors).sort()).toEqual(['GARBAGE', 'I', 'J', 'L', 'O', 'S', 'T', 'Z']);
        const colours = Object.values(WINTER_TETROMINOS.colors);
        for (const colour of colours) expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
        expect(new Set(colours.map((colour) => colour.toLowerCase())).size).toBe(colours.length);
    });

    it('ships no classic shader material, no legacy WebGL renderer and no MaterialX noise', () => {
        // (What is left of the old theme is not the theme: the next test wants it gone.)
        const names = readdirSync(themeDir).filter((name) => name.endsWith('.js') && !RETIRED.includes(name));
        expect(names).toEqual(expect.arrayContaining([
            'composition', 'core', 'director', 'post', 'quality', 'tetrominos', 'theme', 'world',
        ].map((part) => `winter-${part}.js`)));
        for (const name of names) {
            const source = readFileSync(path.join(themeDir, name), 'utf8');
            expect(source, name).not.toMatch(/new\s+[\w$.]*ShaderMaterial\s*\(/);
            expect(source, name).not.toMatch(/new\s+[\w$.]*WebGLRenderer\s*\(/);
            expect(source, name).not.toMatch(/\bmx_\w+\s*[(,]/); // a DXC compile pathology
            expect(source, name).not.toMatch(/from 'three'/);
            // Absolute asset paths resolve to the filesystem root under file:// (packaged Electron).
            expect(source, name).not.toMatch(/['"`]\/(textures|assets|hdri)\//);
            // The world is shared WITH the playground, never borrowed from it.
            expect(source, name).not.toMatch(/from\s+'[^']*playground\//);
        }
    });

    it('has left nothing of the theme it replaces behind', () => {
        for (const retired of RETIRED) {
            expect(existsSync(path.join(themeDir, retired)), retired).toBe(false);
        }
    });

    it('keeps only its container in the page, in the clear colour', () => {
        // The old canvas element and its rule are gone: the theme mounts its own canvas, and the
        // container wears the clear colour so nothing flashes behind it before the first frame.
        const css = readFileSync(path.join(repoRoot, 'public', 'styles', 'main.css'), 'utf8');
        expect(css).not.toMatch(/[#.]winter-(?!theme\b)/);
        expect(css).toMatch(/#winter-theme \{\s*background: #050810;\s*overflow: hidden;\s*\}/);
        const page = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
        expect(page).toMatch(/<div id="winter-theme" class="theme-container">\s*<\/div>/);
        expect(page.match(/id="winter-/g)).toHaveLength(1);
        // The shared 2D renderer draws nothing over it.
        const sharedRenderer = readFileSync(path.join(repoRoot, 'src', 'rendering', 'renderer.js'), 'utf8');
        expect(sharedRenderer).not.toMatch(/winter/i);
    });

    it('documents its capture flags, and every part the world can draw alone', () => {
        const documented = new Map(THEME_URL_PARAMETERS
            .filter((entry) => entry.name.startsWith('winter'))
            .map((entry) => [entry.name, entry]));
        expect([...documented.keys()].sort()).toEqual([
            'winterFalseColor', 'winterFixedDt', 'winterForceWebGL', 'winterParts', 'winterTime',
        ]);
        const listed = documented.get('winterParts').values.replace(/^[^:]*:/, '');
        const parts = listed.split(',').map((name) => name.trim());
        // A part added to the world belongs in src/ui/url-parameters/theme-parameters.js too.
        expect(parts.sort()).toEqual([...WINTER_PARTS].sort());
    });

    it('reads none of the flags of the theme it replaces, and registers none', () => {
        const source = readFileSync(path.join(themeDir, 'winter-theme.js'), 'utf8');
        for (const flag of RETIRED_FLAGS) expect(source, flag).not.toContain(flag);
        expect(FLAG_REGISTRY.filter((flag) => /winter/i.test(flag.name))).toEqual([]);
    });

    it('has a cap and a post look for every tier the world defines, the cap rising with the tier', () => {
        expect(PIXEL_RATIO_CAPS.map(([quality]) => quality)).toEqual(QUALITY_NAMES);
        for (let i = 1; i < PIXEL_RATIO_CAPS.length; i++) {
            expect(PIXEL_RATIO_CAPS[i][1]).toBeGreaterThan(PIXEL_RATIO_CAPS[i - 1][1]);
        }
        for (const name of QUALITY_NAMES) expect(POST_LOOK[name], name).toBeTruthy();
    });
});

describe('Winter theme: one node renderer on both backends', () => {
    it('uses the WebGL2 backend of the node renderer when there is no GPU', async () => {
        stubBrowser();
        const theme = createTheme();
        const renderer = await theme.createRenderer(theme.lifecycleGeneration);
        expect(mocks.instances).toHaveLength(1);
        expect(renderer.options.forceWebGL).toBe(true);
        expect(renderer.isWebGPURenderer).toBe(true);
    });

    it.each(['?forceWebGL=1', '?winterForceWebGL', '?winterForceWebGL=true'])(
        'honours %s even when a GPU is present',
        async (search) => {
            stubBrowser({ gpu: true, search });
            const theme = createTheme();
            const renderer = await theme.createRenderer(theme.lifecycleGeneration);
            expect(mocks.instances).toHaveLength(1);
            expect(renderer.options.forceWebGL).toBe(true);
        },
    );

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

    it('fails a start that has nowhere to mount', async () => {
        stubBrowser();
        vi.stubGlobal('document', { getElementById: () => null });
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/container not found/);
        expect(mocks.instances).toHaveLength(0);
        expect(mocks.loadGhosts).not.toHaveBeenCalled();
    });

    it('builds the scene, keeps a single-output scene pass and parks nothing to warm', async () => {
        mocks.fullBake = true;
        const { theme, container } = await startTheme({ gpu: true, quality: 'High' });
        expect(theme.renderer).toBe(mocks.instances[0]);
        expect(theme.isWebGPU).toBe(true);
        expect(container.replaceChildren).toHaveBeenCalledOnce(); // the container starts empty
        expect(container.appendChild).toHaveBeenCalledWith(theme.renderer.domElement);
        expect(theme.renderer.setClearColor).toHaveBeenCalledWith(0x050810, 1);
        // Tone mapping happens once, in the post stack.
        expect(theme.renderer.toneMapping).toBe(THREE.NoToneMapping);
        // The canvas only receives the output quad: the scene pass owns depth and MSAA.
        expect(theme.renderer.options).toMatchObject({ antialias: false, depth: false, alpha: false });
        expect(theme.world).toBeInstanceOf(WinterWorld);
        expect(theme.post).toBeTruthy();
        expect(theme.passThrough).toBeNull();
        expect(theme.director).toBeTruthy();
        expect(await theme.whenCriticalReady()).toBe(true);
        expect(theme.usesMrtScenePass()).toBe(false);
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(theme.getTetrominoConfig()).toBe(WINTER_TETROMINOS);
        expect(theme.getDiagnostics()).toMatchObject({
            backend: 'WebGPU',
            quality: 'High',
            ghosts: 'asset',
            droppedEvents: 0,
            reducedMotion: false,
            world: {
                quality: 'High', combo: 0, level: 1, hour: HOURS[0].name, source: 'asset',
            },
        });
        // The camera stands on the rig the snowfield is composed for.
        expect(theme.camera.fov).toBeCloseTo(fovForAspect(1280 / 720), 3);
        expect(theme.camera.near).toBe(REST_RIG.near);
        expect(theme.camera.far).toBe(REST_RIG.far);
        const materials = [];
        theme.scene.traverse((object) => { if (object.material) materials.push(object.material); });
        expect(materials.length).toBeGreaterThan(0);
        expect(materials.every((m) => m.isNodeMaterial && !m.isShaderMaterial)).toBe(true);
        // The loop is running.
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        expect(console.log).toHaveBeenCalledWith('[Winter] Scene ready (WebGPU, High, ghosts: asset)');
    }, FULL_BAKE_TIMEOUT_MS);

    it('names the fox of light as the one drawable parked until its event, once it is there', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        // No model arrived here, so there is no body and no fox of light to park.
        expect(theme.world.getState().fox.body).toBe(false);
        expect(theme.getWarmupRoots()).toEqual([]);
        const mesh = new THREE.Group();
        theme.world.spirit = { mesh, update: () => 0, dispose: vi.fn() };
        expect(theme.getWarmupRoots()).toEqual([mesh]);
        expect(() => stepFrames(theme, 2)).not.toThrow();
        theme.disposeRuntime();
        expect(theme.getWarmupRoots()).toEqual([]);
    });

    it('builds the same scene on the WebGL2 backend', async () => {
        mocks.fullBake = true;
        const { theme } = await startTheme({ quality: 'High' });
        expect(theme.isWebGPU).toBe(false);
        expect(theme.getDiagnostics().backend).toBe('WebGL2');
        expect(theme.post).toBeTruthy();
        expect(() => theme.stepFrame(16)).not.toThrow();
        expect(theme.post.pipeline.render).toHaveBeenCalledOnce();
        expect(theme.renderer.compute).not.toHaveBeenCalled();
        expect(mocks.surfaces).toHaveLength(0); // WebGL2 recovers through the context-restored restart
    }, FULL_BAKE_TIMEOUT_MS);

    it.each(PIXEL_RATIO_CAPS)('builds the %s tier and caps its pixel ratio at %s', async (quality, cap) => {
        mocks.fullBake = true; // the tier as it ships: its own fan, its own shadows
        stubBrowser({ quality });
        const theme = createTheme();
        const ratio = vi.spyOn(theme, 'getEffectivePixelRatio');
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.quality).toBe(quality);
        expect(theme.world.getState().quality).toBe(quality);
        expect(theme.post.look).toBe(POST_LOOK[quality]);
        expect(ratio).toHaveBeenCalledWith(cap, 'theme');
        expect(theme.renderer.setPixelRatio).toHaveBeenCalledWith(ratio.mock.results[0].value);
        expect(theme.renderer.getPixelRatio()).toBeLessThanOrEqual(cap);
        expect(() => theme.stepFrame(16)).not.toThrow();
    }, FULL_BAKE_TIMEOUT_MS);

    it('falls back to a pass-through pipeline when the post stack cannot be built', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failPipelines = 1;
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.post).toBeNull();
        expect(theme.passThrough).toBeTruthy();
        expect(theme.renderer.toneMapping).toBe(THREE.AgXToneMapping);
        const render = vi.spyOn(theme.passThrough, 'render');
        expect(() => stepFrames(theme, 3)).not.toThrow();
        expect(render).toHaveBeenCalledTimes(3);
        const dispose = vi.spyOn(theme.passThrough, 'dispose');
        theme.disposeRuntime();
        expect(dispose).toHaveBeenCalledOnce();
        expect(theme.passThrough).toBeNull();
    });

    it('rejects a start whose post cannot be built at all, leaving nothing behind', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failPipelines = 2; // the post stack and its pass-through fallback
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const dispose = vi.spyOn(WinterWorld.prototype, 'dispose');
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/pipeline unavailable/);
        expect(dispose).toHaveBeenCalledOnce();
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.scene).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });
});

describe('Winter theme: the snow ghosts are read before the world is built', () => {
    it('builds nothing and runs nothing until the ghosts have arrived', async () => {
        stubBrowser({ gpu: true, quality: 'High' });
        const gate = deferred();
        mocks.loadGhosts = vi.fn(() => gate.promise);
        const build = vi.spyOn(WinterWorld.prototype, 'build');
        const theme = createTheme();
        const start = theme.createScene(theme.lifecycleGeneration);
        await vi.waitFor(() => expect(mocks.loadGhosts).toHaveBeenCalledOnce());

        // The renderer is up, mounted and watched for a lost device; the world is not there yet.
        expect(theme.renderer).toBe(mocks.instances[0]);
        expect(mocks.surfaces).toHaveLength(1);
        expect(build).not.toHaveBeenCalled();
        expect(theme.world).toBeNull();
        expect(theme.post).toBeNull();
        expect(theme.director).toBeNull();
        expect(await theme.whenCriticalReady()).toBe(false);
        expect(theme.getDiagnostics()).toMatchObject({ ghosts: null, world: null });
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        // Nothing that reaches a theme in that state trips over the missing world.
        expect(() => {
            theme.stepFrame(16);
            theme.resize(800, 600);
            theme.resetSession();
            theme.handleGameOver();
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        }).not.toThrow();
        expect(theme.resume()).toBe(false);

        gate.resolve(mocks.ghosts('asset'));
        await start;
        expect(build).toHaveBeenCalledOnce();
        expect(theme.world).toBe(build.mock.contexts[0]);
        expect(theme.post).toBeTruthy();
        expect(await theme.whenCriticalReady()).toBe(true);
        expect(theme.getDiagnostics().ghosts).toBe('asset');
        expect(theme.world.getState().source).toBe('asset');
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        // The size a resize asked for while it waited is not the size it starts at.
        expect(theme.renderer.setSize).toHaveBeenLastCalledWith(1280, 720, false);
    });

    it('stands among the stand-ins when the asset cannot be read', async () => {
        stubBrowser({ quality: 'Low' });
        mocks.loadGhosts = vi.fn(async () => mocks.ghosts('plan'));
        const theme = createTheme();
        // Never a failed start: the loader does not reject, and the wood is always there.
        await expect(theme.createScene(theme.lifecycleGeneration)).resolves.toBeUndefined();
        expect(theme.getDiagnostics()).toMatchObject({ ghosts: 'plan', world: { source: 'plan' } });
        expect(theme.world.getState().trees).toBeGreaterThan(0);
        expect(console.log).toHaveBeenCalledWith('[Winter] Scene ready (WebGL2, Low, ghosts: plan)');
        expect(() => stepFrames(theme, 2)).not.toThrow();
    });

    it('retires the world it was waiting for when the theme stops first', async () => {
        stubBrowser({ gpu: true, quality: 'High' });
        const gate = deferred();
        mocks.loadGhosts = vi.fn(() => gate.promise);
        const load = vi.spyOn(WinterWorld.prototype, 'load');
        const build = vi.spyOn(WinterWorld.prototype, 'build');
        const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
        const theme = createTheme();
        const start = theme.createScene(theme.lifecycleGeneration);
        await vi.waitFor(() => expect(mocks.loadGhosts).toHaveBeenCalledOnce());
        const [waiting] = load.mock.contexts;

        theme.stop();
        // The stop retired what was published: the renderer, its monitors.
        expect(theme.renderer).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        expect(mocks.surfaces[0].unregister).toHaveBeenCalledOnce();
        expect(waiting.disposed).toBe(false); // the stop could not see it

        gate.resolve(mocks.ghosts('asset'));
        await expect(start).resolves.toBeUndefined(); // a cancelled start is not a failed one
        expect(waiting.disposed).toBe(true);
        expect(build).not.toHaveBeenCalled();
        expect(theme.world).toBeNull();
        expect(theme.director).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        expect(failed).not.toHaveBeenCalled();
    });

    it('lets a newer start win over one still waiting for its ghosts', async () => {
        stubBrowser({ gpu: true, quality: 'High' });
        const gate = deferred();
        mocks.loadGhosts = vi.fn()
            .mockImplementationOnce(() => gate.promise)
            .mockImplementation(async () => mocks.ghosts('asset'));
        const load = vi.spyOn(WinterWorld.prototype, 'load');
        const build = vi.spyOn(WinterWorld.prototype, 'build');
        const theme = createTheme();
        const first = theme.createScene(theme.lifecycleGeneration);
        await vi.waitFor(() => expect(mocks.loadGhosts).toHaveBeenCalledOnce());
        // A second build (a quality change, a recovery) starts and finishes meanwhile.
        await theme.createScene(theme.lifecycleGeneration);
        const winner = theme.world;
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });

        gate.resolve(mocks.ghosts('asset'));
        await first;
        // The late world is retired unbuilt; the running scene is not touched.
        const [stale] = load.mock.contexts;
        expect(stale).not.toBe(winner);
        expect(stale.disposed).toBe(true);
        expect(build).toHaveBeenCalledOnce();
        expect(build.mock.contexts[0]).toBe(winner);
        expect(theme.world).toBe(winner);
        expect(winner.disposed).toBe(false);
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        expect(() => stepFrames(theme, 2)).not.toThrow();
    });

    it('retires what it had published when its start is invalidated without a stop', async () => {
        stubBrowser({ gpu: true, quality: 'High' });
        const theme = createTheme();
        const generation = theme.lifecycleGeneration;
        mocks.loadGhosts = vi.fn(async () => {
            theme.lifecycleGeneration += 1; // a newer start owns the lifecycle now
            return mocks.ghosts('asset');
        });
        const load = vi.spyOn(WinterWorld.prototype, 'load');
        await theme.createScene(generation);
        expect(load.mock.contexts[0].disposed).toBe(true);
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.scene).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        expect(mocks.surfaces[0].unregister).toHaveBeenCalledOnce();
    });

    it('retires a world whose build fails, and rejects the start', async () => {
        stubBrowser({ quality: 'High' });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const build = vi.spyOn(WinterWorld.prototype, 'build').mockImplementation(() => {
            throw new Error('no snow to stand on');
        });
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/no snow to stand on/);
        expect(build.mock.contexts[0].disposed).toBe(true);
        expect(theme.world).toBeNull();
        expect(theme.post).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(console.error).toHaveBeenCalledWith('[Winter] Scene creation failed:', expect.any(Error));
    });

    it('leaves nothing behind even if a load breaks its promise never to reject', async () => {
        stubBrowser({ quality: 'High' });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const load = vi.spyOn(WinterWorld.prototype, 'load').mockRejectedValue(new Error('bad ghosts'));
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/bad ghosts/);
        expect(load.mock.contexts[0].disposed).toBe(true);
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
    });
});

describe('Winter theme: gameplay', () => {
    it('listens to every event its director names, and to none of them while paused', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        const handlers = Object.entries(WINTER_EVENT_HANDLERS)
            .map(([event, handler]) => [event, vi.spyOn(theme.director, handler)]);
        expect(handlers).toHaveLength(8);
        for (const [event, handler] of handlers) {
            const payload = { piece: T, level: 2 };
            eventBus.emit(EVENTS[event], payload);
            expect(handler, event).toHaveBeenCalledOnce();
            expect(handler, event).toHaveBeenCalledWith(payload);
        }
        theme.isPaused = true;
        for (const [event, handler] of handlers) {
            eventBus.emit(EVENTS[event], { piece: T });
            expect(handler, event).toHaveBeenCalledOnce();
        }
    });

    it('stages gameplay on the bus and lands it on the next frame', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const world = watchWorld(theme.world);
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        expect(world.lock).not.toHaveBeenCalled(); // staged, not yet applied
        expect(world.clear).not.toHaveBeenCalled();
        theme.stepFrame(16);
        expect(world.lock).toHaveBeenCalledOnce();
        expect(world.clear).toHaveBeenCalledOnce();
        expect(world.combo).toHaveBeenLastCalledWith(1);
        expect(theme.world.getState()).toMatchObject({ combo: 1, counts: { locks: 1, clears: 1 } });
        // The lock threw its sparks: nothing was created for them, the pool was there.
        expect(theme.world.getState().counts.sparks).toBeGreaterThan(0);

        // Paused: the bus is ignored, nothing is staged for later.
        theme.isPaused = true;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.isPaused = false;
        theme.stepFrame(32);
        expect(world.lock).toHaveBeenCalledOnce();
    });

    it('aims through the frame\'s camera: the camera moves, then gameplay lands, then the world updates', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        const camera = vi.spyOn(theme.world, 'updateCamera');
        const lock = vi.spyOn(theme.world, 'onLock');
        const update = vi.spyOn(theme.world, 'update');
        const post = vi.spyOn(theme.post, 'render');
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        const order = [camera, lock, update, post].map((spy) => spy.mock.invocationCallOrder[0]);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(camera).toHaveBeenCalledWith(theme.camera, expect.objectContaining({ time: theme.time, delta: 1 / 60 }));
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ time: theme.time }), theme.camera);
    });

    it('carries a hard drop, a four-line clear and a new level through the director to the night', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const world = watchWorld(theme.world);
        eventBus.emit(EVENTS.HARD_DROP, { piece: I, distance: 12 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        theme.stepFrame(16);
        // One harder lock, in the piece's colour, at its column and row.
        expect(world.lock).toHaveBeenCalledOnce();
        expect(world.lock.mock.calls[0][0]).toMatchObject({
            hardDrop: true, color: WINTER_TETROMINOS.colors.I, rows: [19], player: 0,
        });
        expect(world.lock.mock.calls[0][0].u).toBeCloseTo(0.8, 6);
        expect(world.clear).toHaveBeenCalledOnce();
        expect(world.clear.mock.calls[0][0]).toMatchObject({ lines: 4, rows: [19, 18, 17, 16] });
        expect(world.levelUp).toHaveBeenCalledWith(3);
        // The third level is the third hour of the polar day.
        expect(theme.world.getState()).toMatchObject({
            level: 3, hour: HOURS[2].name, combo: 1, counts: { locks: 1, clears: 1, quads: 1 },
        });
        // The post follows the night: the kick of the drop, the clock for its grain, the moon
        // its glare hangs on.
        expect(theme.post.uKick.value).toBeGreaterThan(0);
        expect(theme.post.uTime.value).toBe(theme.time);
        expect(theme.post.uHeart.value.x).toBeCloseTo(theme.world.heart.x, 9);
        expect(theme.post.uHeart.value.y).toBeCloseTo(theme.world.heart.y, 9);
    });

    it('turns the hours with the levels, and round again after the last', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        // (Kaamos, rose noon, the blue hour, violet dusk, deep night: each hour its own.)
        expect(HOURS.length).toBeGreaterThan(1);
        expect(new Set(HOURS.map(({ name }) => name)).size).toBe(HOURS.length);
        for (let level = 1; level <= HOURS.length + 2; level++) {
            eventBus.emit(EVENTS.LEVEL_UP, { level });
            stepFrames(theme, 1);
            expect(theme.world.getState().hour, `level ${level}`).toBe(HOURS[(level - 1) % HOURS.length].name);
        }
    });

    it('burns the fires to the longest chain on any board', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const combo = vi.spyOn(theme.world, 'onCombo');
        theme.reportCombo(2, 1);
        theme.reportCombo(5, 2);
        expect(combo).toHaveBeenLastCalledWith(5);
        theme.reportCombo(0, 2);
        expect(combo).toHaveBeenLastCalledWith(2);
        theme.reportCombo(0, 1);
        expect(combo).toHaveBeenLastCalledWith(0);
        expect(theme.world.getState().combo).toBe(0);
        // And through the bus: two boards, each with its own chain.
        for (let i = 0; i < 3; i++) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: I, player: 1 });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], player: 1 });
            if (i === 0) {
                eventBus.emit(EVENTS.PIECE_LOCK, { piece: T, player: 2 });
                eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], player: 2 });
            }
            stepFrames(theme, 1);
        }
        expect(theme.combos.get(1)).toBe(3);
        expect(theme.combos.get(2)).toBe(1);
        expect(theme.world.getState().combo).toBe(3);
        // The chain is the charge: held, the fires burn up and the fox runs.
        const lit = theme.world.getState().power;
        stepFrames(theme, 120);
        expect(theme.world.getState().power).toBeGreaterThan(lit);
        expect(theme.world.getState().fox.speed).toBeGreaterThan(2);
    });

    it('honours the reaction settings', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const world = watchWorld(theme.world);
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(world.lock).not.toHaveBeenCalled();
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: true, pieceLockRipple: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        theme.stepFrame(32);
        expect(world.lock).not.toHaveBeenCalled();
        expect(world.clear).toHaveBeenCalledOnce();
        theme.handleSettingsChanged({ detail: { reducedMotion: true } });
        expect(theme.world.reducedMotion).toBe(true);
        expect(theme.getDiagnostics().reducedMotion).toBe(true);
        // Every shape a settings payload arrives in.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { reducedMotion: false }, source: 'menu' });
        expect(theme.world.reducedMotion).toBe(false);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'reducedMotion', value: 'true' });
        expect(theme.world.reducedMotion).toBe(true);
    });

    it('starts with the settings already saved, and with the system\'s reduced-motion preference', async () => {
        const saved = await startTheme({ quality: 'Low', settings: { pieceLockRipple: false, reducedMotion: 'on' } });
        expect(saved.theme.world.reducedMotion).toBe(true);
        expect(saved.theme.director.lockRipple).toBe(false);
        expect(saved.theme.director.enabled).toBe(true);
        saved.theme.disposeRuntime();

        const system = await startTheme({ quality: 'Low', reducedMotion: true });
        expect(system.theme.reducedMotion).toBe(true);
        expect(system.theme.world.reducedMotion).toBe(true);
        // The setting cannot switch off what the system asks for.
        system.theme.handleSettingsChanged({ detail: { reducedMotion: false } });
        expect(system.theme.world.reducedMotion).toBe(true);
        // The viewer stands still in the snow.
        stepFrames(system.theme, 30);
        expect(system.theme.camera.position.toArray()).toEqual([EYE.x, EYE.y, EYE.z]);
    });
});

describe('Winter theme: the end of a run', () => {
    /** Three clears in a row on the solo board: a chain of three. */
    function playChain(theme) {
        for (let i = 0; i < 3; i++) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            stepFrames(theme, 1);
        }
    }

    it('hears game over from the window, not from the bus', async () => {
        const { theme, listeners } = await startTheme({ quality: 'Low' });
        expect(listeners.get('gameOver')).toBeTypeOf('function');
        // The canonical bus has no event for the end of a run, and none for its start.
        expect(EVENTS.GAME_OVER).toBeUndefined();
        expect(EVENTS.GAME_START).toBeUndefined();
        const source = readFileSync(path.join(themeDir, 'winter-theme.js'), 'utf8');
        expect(source).not.toMatch(/EVENTS\.GAME_(OVER|START)/);
        const world = watchWorld(theme.world);
        listeners.get('gameOver')({ detail: { gameState: {} } });
        expect(world.gameOver).toHaveBeenCalledOnce();
        expect(world.gameOver).toHaveBeenCalledWith();
    });

    it('puts the night back at rest, then gives it its ending', async () => {
        const { theme, listeners } = await startTheme({ quality: 'High' });
        playChain(theme);
        expect(theme.world.getState().combo).toBe(3);
        expect(theme.combos.get(0)).toBe(3);
        const world = watchWorld(theme.world);
        const lit = theme.world.getState().power;
        listeners.get('gameOver')();
        // The chain breaks, the session is reset, and only then does the ending play: a reset
        // after it would take it away again (it wakes the fox).
        expect(world.combo).toHaveBeenCalledWith(0);
        expect(world.reset).toHaveBeenCalledOnce();
        expect(world.gameOver).toHaveBeenCalledOnce();
        const order = [world.combo, world.reset, world.gameOver].map((spy) => spy.mock.invocationCallOrder[0]);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(theme.world.getState()).toMatchObject({
            combo: 0, level: 1, hour: HOURS[0].name, counts: { locks: 0, clears: 0, quads: 0 },
        });
        // Nothing jumps: the fires the chain had raised are left to sink on their own.
        expect(theme.world.getState().power).toBe(lit);
        stepFrames(theme, 240);
        expect(theme.world.getState().power).toBeLessThan(lit * 0.3);
        expect(theme.combos.size).toBe(0);
        // The fox has curled up.
        expect(theme.world.getState().fox).toMatchObject({ mode: 'sleep', clip: 'CurlSleep' });
        // The next run's first clear is a chain of one again.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        stepFrames(theme, 1);
        expect(theme.world.getState().combo).toBe(1);
        expect(world.gameOver).toHaveBeenCalledOnce();
    });

    it('wakes the fox when the next run starts, though no mode was stopped', async () => {
        const { theme, listeners, win } = await startTheme({ quality: 'Low' });
        const manager = modeManager();
        win.serenityBlocks = { gameModeManager: manager };
        stepFrames(theme, 1); // the layout watch finds the manager
        playChain(theme);
        listeners.get('gameOver')();
        stepFrames(theme, 120);
        expect(theme.world.getState().fox.mode).toBe('sleep');
        // A mode that ended its own run is not running: the manager starts it again without
        // stopping it, so the start is all the theme hears of the new run.
        const world = watchWorld(theme.world);
        const layout = vi.spyOn(theme.world, 'setLayout');
        manager.handlers.get('modeStarted')();
        expect(world.reset).toHaveBeenCalledOnce();
        expect(world.gameOver).not.toHaveBeenCalled();
        expect(theme.world.getState().fox.mode).not.toBe('sleep');
        stepFrames(theme, 1);
        expect(theme.world.getState().fox.clip).toBe('Stretch');
        expect(layout).toHaveBeenCalledOnce(); // and the board is read again
        // A mode that is only activated is not a run.
        manager.handlers.get('modeActivated')();
        expect(world.reset).toHaveBeenCalledOnce();
        // Stretched, it is back on its round.
        stepFrames(theme, 300);
        expect(theme.world.getState().fox).toMatchObject({ mode: 'gait', clip: 'Run' });
    });

    it('forgets the run but plays no ending while paused, or with reactions switched off', async () => {
        const { theme, listeners } = await startTheme({ quality: 'Low' });
        playChain(theme);
        const world = watchWorld(theme.world);
        theme.isPaused = true;
        listeners.get('gameOver')();
        theme.isPaused = false;
        expect(world.reset).toHaveBeenCalledOnce();
        expect(world.gameOver).not.toHaveBeenCalled();
        expect(theme.world.getState().combo).toBe(0);

        theme.handleSettingsChanged({ detail: { backgroundComboEffects: false } });
        listeners.get('gameOver')();
        expect(world.reset).toHaveBeenCalledTimes(2);
        expect(world.gameOver).not.toHaveBeenCalled();
        // Nothing was held back for later.
        stepFrames(theme, 2);
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: true } });
        stepFrames(theme, 2);
        expect(world.gameOver).not.toHaveBeenCalled();
        expect(theme.world.getState().fox.mode).not.toBe('sleep');
    });
});

describe('Winter theme: settings, size and the layout watch', () => {
    it('rebuilds on a quality change and not on an unrelated setting', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const rebuild = vi.spyOn(theme, 'createScene').mockResolvedValue();
        theme.handleSettingsChanged({ detail: { musicVolume: 0.2 } });
        theme.handleSettingsChanged({ detail: { effectQuality: 'High' } }); // the tier it already has
        await Promise.resolve();
        expect(rebuild).not.toHaveBeenCalled();
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        await Promise.resolve();
        expect(rebuild).toHaveBeenCalledTimes(1);
        expect(theme.pendingQuality).toBe('Low');
    });

    it('builds the new tier on a quality change', async () => {
        const { theme, win } = await startTheme({ quality: 'High' });
        const first = theme.world;
        win.settings.effectQuality = 'Minimal';
        theme.handleSettingsChanged({ detail: { effectQuality: 'Minimal' } });
        // The rebuild is queued a microtask later, reads its ghosts and builds a whole world: wait.
        await vi.waitFor(() => expect(theme.world?.getState().quality).toBe('Minimal'), { timeout: 4000 });
        expect(theme.quality).toBe('Minimal');
        expect(theme.world).not.toBe(first);
        expect(first.disposed).toBe(true);
        expect(theme.pendingQuality).toBeNull();
        expect(mocks.instances).toHaveLength(2);
        expect(mocks.loadGhosts).toHaveBeenCalledTimes(2);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        // One set of listeners, not two: a lock lands once.
        const lock = vi.spyOn(theme.world, 'onLock');
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(lock).toHaveBeenCalledOnce();
    });

    it('reports a failed rebuild to the manager', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        theme.onRuntimeFailure = vi.fn();
        const failure = new Error('rebuild failed');
        vi.spyOn(theme, 'createScene').mockRejectedValue(failure);
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        await vi.waitFor(() => expect(theme.onRuntimeFailure).toHaveBeenCalledWith(failure));
    });

    it('waits for the menu to close before rebuilding a paused theme', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        theme.hasStarted = true;
        expect(theme.pause()).toBe(true);
        expect(theme.lastFrameMs).toBeNull();
        const rebuild = vi.spyOn(theme, 'createScene').mockResolvedValue();
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        await Promise.resolve();
        expect(rebuild).not.toHaveBeenCalled();
        expect(theme.rebuildPending).toBe(true);
        expect(theme.resume()).toBe(true);
        await Promise.resolve();
        expect(rebuild).toHaveBeenCalledTimes(1);
        expect(theme.rebuildPending).toBe(false);
    });

    it('pauses and resumes without rebuilding, and catches up on a resize it missed', async () => {
        const { theme, win } = await startTheme({ quality: 'High' });
        theme.hasStarted = true;
        const { world, renderer } = theme;
        stepFrames(theme, 2);
        expect(theme.pause()).toBe(true);
        expect(theme.pause()).toBe(false);
        expect(theme.lifecycleState).toBe('paused');
        win.innerWidth = 900;
        win.innerHeight = 700;
        expect(theme.resume()).toBe(true);
        expect(theme.world).toBe(world);
        expect(theme.renderer).toBe(renderer);
        expect(mocks.loadGhosts).toHaveBeenCalledOnce();
        expect(renderer.setSize).toHaveBeenLastCalledWith(900, 700, false);
        expect(theme.camera.aspect).toBeCloseTo(900 / 700, 9);
        // The first frame back does not jump by the time spent parked.
        const before = theme.time;
        theme.stepFrame(600000);
        expect(theme.time - before).toBeCloseTo(1 / 60, 9);
        // A theme with nothing built cannot resume: the manager restarts it.
        theme.disposeRuntime();
        expect(theme.resume()).toBe(false);
    });

    it('follows a resize once and tells the world, the post and the director', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const { renderer } = theme;
        renderer.setSize.mockClear();
        const viewport = vi.spyOn(theme.world, 'setViewport');
        const post = vi.spyOn(theme.post, 'setSize');
        theme.resize(800, 600);
        theme.resize(800, 600);
        theme.resize(800.4, 599.6); // the same size in whole pixels
        expect(renderer.setSize).toHaveBeenCalledTimes(1);
        expect(renderer.setSize).toHaveBeenCalledWith(800, 600, false);
        expect(theme.camera.aspect).toBeCloseTo(800 / 600, 9);
        const ratio = renderer.getPixelRatio();
        expect(viewport).toHaveBeenCalledWith(Math.floor(800 * ratio), Math.floor(600 * ratio), 800 / 600);
        expect(post).toHaveBeenCalledWith(800, 600, Math.floor(800 * ratio), Math.floor(600 * ratio));
        expect(theme.director.viewportWidth).toBe(800);
        expect(theme.director.viewportHeight).toBe(600);
        // Through the bus as well; nonsense is clamped to a pixel.
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 1024, height: 768 });
        expect(renderer.setSize).toHaveBeenLastCalledWith(1024, 768, false);
        expect(() => theme.resize(NaN, -5)).not.toThrow();
        expect(renderer.setSize).toHaveBeenLastCalledWith(1, 1, false);
    });

    it('lays the picture out again for an upright screen, and goes on drawing', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        stepFrames(theme, 2);
        const wide = theme.world.getState();
        theme.resize(430, 932);
        expect(theme.world.aspect).toBeCloseTo(430 / 932, 9);
        expect(() => stepFrames(theme, 3)).not.toThrow();
        // The wood and the fox are still there, drawn in to the narrower frame.
        const tall = theme.world.getState();
        expect(wide.trees).toBeGreaterThan(0);
        expect(tall.trees).toBeGreaterThan(0);
        expect(theme.camera.fov).toBeCloseTo(fovForAspect(430 / 932), 1);
        expect(Math.abs(tall.fox.x)).toBeLessThan(40);
        // The moon stays in the frame its glare is drawn in.
        expect(tall.heart.x).toBeGreaterThan(0);
        expect(tall.heart.x).toBeLessThan(1);
        expect(tall.heart.y).toBeGreaterThan(0);
        expect(tall.heart.y).toBeLessThan(1);
    });

    it('follows the real drawing buffer when something else resizes the renderer', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        stepFrames(theme, 1);
        const viewport = vi.spyOn(theme.world, 'setViewport');
        const post = vi.spyOn(theme.post, 'setSize');
        stepFrames(theme, 1);
        expect(viewport).not.toHaveBeenCalled();
        theme.renderer.size = { width: 640, height: 360 };
        stepFrames(theme, 1);
        const ratio = theme.renderer.getPixelRatio();
        expect(viewport).toHaveBeenCalledWith(Math.floor(640 * ratio), Math.floor(360 * ratio), 1280 / 720);
        expect(post).toHaveBeenCalledWith(1280, 720, Math.floor(640 * ratio), Math.floor(360 * ratio));
    });

    it('re-applies its pixel ratio when the render scale changes', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const ratio = vi.spyOn(theme, 'getEffectivePixelRatio').mockReturnValue(0.6);
        const viewport = vi.spyOn(theme.world, 'setViewport');
        theme.handleSettingsChanged({ detail: { renderScale: 0.6 } });
        expect(theme.renderer.setPixelRatio).not.toHaveBeenCalledWith(0.6); // deferred a microtask
        await Promise.resolve();
        expect(ratio).toHaveBeenCalled();
        expect(theme.renderer.setPixelRatio).toHaveBeenLastCalledWith(0.6);
        expect(viewport).toHaveBeenLastCalledWith(Math.floor(1280 * 0.6), Math.floor(720 * 0.6), 1280 / 720);
    });

    it('reads the board on frame time, aims the world at it and calms the post over the card', async () => {
        const { theme, page, win } = await startTheme({ quality: 'High' });
        const manager = modeManager();
        win.serenityBlocks = { gameModeManager: manager };
        const layout = vi.spyOn(theme.world, 'setLayout');
        // Nothing on screen: the world aims at where the solo board would stand, the post is not calmed.
        stepFrames(theme, 2);
        expect(layout).toHaveBeenLastCalledWith(null);
        expect(theme.world.getState().layoutLive).toBe(false);
        expect(theme.layout).toMatchObject({ applied: null, live: false });
        expect(theme.post.uCalmStrength.value).toBe(0);
        // The mode manager turned up after the build: the theme subscribes once.
        expect([...manager.handlers.keys()].sort()).toEqual(['modeActivated', 'modeStarted', 'modeStopped']);
        expect(manager.on).toHaveBeenCalledTimes(3);

        // A mode starts: a card, its board and the HUD appear.
        page.cards = [box(440, 40, 400, 640)];
        page.canvas = box(490, 150, 300, 500);
        page.hud = box(900, 200, 140, 320);
        stepFrames(theme, 5);
        expect(theme.world.getState().layoutLive).toBe(false); // no polling: the next read is on a schedule
        manager.handlers.get('modeStarted')();
        stepFrames(theme, 1);
        expect(theme.world.getState().layoutLive).toBe(true);
        expect(layout.mock.lastCall[0]).toBe(theme.layout.applied);
        expect(theme.world.layout.boards[0].x0).toBeCloseTo(490 / 1280, 9);
        expect(theme.layout.live).toBe(true);
        // The calm zones ease in over the card and the HUD.
        expect(theme.post.calmRects[0].toArray()).toEqual([440 / 1280, 40 / 720, 840 / 1280, 680 / 720]);
        expect(theme.post.calmRects[1].toArray()).toEqual([900 / 1280, 200 / 720, 1040 / 1280, 520 / 720]);
        expect(theme.post.calmRects[2].toArray()).toEqual([0, 0, 0, 0]);
        const easing = theme.post.uCalmStrength.value;
        expect(easing).toBeGreaterThan(0);
        expect(easing).toBeLessThan(0.5);
        stepFrames(theme, 240);
        expect(theme.post.uCalmStrength.value).toBeGreaterThan(0.99);
        // The scheduled re-reads have all landed by now, and nothing reads after them.
        const reads = layout.mock.calls.length;
        stepFrames(theme, 120);
        expect(layout).toHaveBeenCalledTimes(reads);
        expect(manager.on).toHaveBeenCalledTimes(3); // and nobody subscribed twice

        // The mode ends: the run is forgotten, the board is gone, the calm zones fade on the last rects.
        page.cards = [];
        page.canvas = null;
        page.hud = null;
        const reset = vi.spyOn(theme.world, 'resetSession');
        const ending = vi.spyOn(theme.world, 'onGameOver');
        manager.handlers.get('modeStopped')();
        expect(reset).toHaveBeenCalledOnce();
        expect(ending).not.toHaveBeenCalled(); // a mode that stops is not a run that was lost
        stepFrames(theme, 1);
        expect(theme.world.getState().layoutLive).toBe(false);
        expect(theme.layout.live).toBe(false);
        expect(theme.layout.applied).toBeTruthy();
        expect(theme.post.calmRects[0].z).toBeCloseTo(840 / 1280, 9);
        expect(theme.post.uCalmStrength.value).toBeLessThan(1);
        stepFrames(theme, 300);
        expect(theme.post.uCalmStrength.value).toBeLessThan(0.01);
        // Teardown lets go of the manager.
        theme.disposeRuntime();
        expect(manager.off).toHaveBeenCalledTimes(3);
        expect(theme.modeManager).toBeNull();
    });

    it('calms the post over four local boards at most, and the HUD after them', async () => {
        const { theme, page } = await startTheme({ quality: 'Low' });
        page.cards = [0, 1, 2, 3, 4].map((i) => box(40 + i * 240, 100, 200, 500));
        page.hud = box(1100, 620, 140, 80);
        const calm = vi.spyOn(theme.post, 'setCalmRects');
        stepFrames(theme, 1);
        const [rects, strength] = calm.mock.lastCall;
        expect(rects).toHaveLength(5);
        expect(rects.slice(0, 4).map((r) => r.x0)).toEqual([0, 1, 2, 3].map((i) => (40 + i * 240) / 1280));
        expect(rects[4]).toEqual(theme.layout.applied.hud);
        expect(strength).toBeGreaterThan(0);
    });

    it('leans the view with the pointer, but not for a touch, a paused theme or reduced motion', async () => {
        const { theme, listeners } = await startTheme({ quality: 'Low' });
        stepFrames(theme, 1);
        const camera = vi.spyOn(theme.world, 'updateCamera');
        const move = listeners.get('pointermove');
        move({ clientX: 1280, clientY: 360, pointerType: 'mouse' });
        expect(theme.pointer).toMatchObject({ x: 1, y: 0 });
        stepFrames(theme, 60);
        // Eased, never snapped, and handed to the world's camera rig.
        expect(theme.pointer.sx).toBeGreaterThan(0.5);
        expect(theme.pointer.sx).toBeLessThan(1);
        expect(camera.mock.lastCall[1]).toMatchObject({ pointerX: theme.pointer.sx, pointerY: theme.pointer.sy });
        move({ clientX: -400, clientY: 9000, pointerType: 'pen' });
        expect(theme.pointer).toMatchObject({ x: -1, y: 1 });
        // Each of these lets the view fall back to rest.
        move({ clientX: 900, clientY: 100, pointerType: 'touch' });
        expect(theme.pointer).toMatchObject({ x: 0, y: 0 });
        move({ clientX: 900, clientY: 100, pointerType: 'mouse' });
        move({ clientX: 900, clientY: 100, isPrimary: false });
        expect(theme.pointer.x).toBe(0);
        move({ clientX: 900, clientY: 100 });
        move({ clientX: NaN, clientY: 100 });
        expect(theme.pointer.x).toBe(0);
        move({ clientX: 900, clientY: 100 });
        listeners.get('pointerleave')();
        expect(theme.pointer.x).toBe(0);
        move({ clientX: 900, clientY: 100 });
        listeners.get('blur')();
        expect(theme.pointer.x).toBe(0);
        theme.isPaused = true;
        move({ clientX: 900, clientY: 100 });
        expect(theme.pointer.x).toBe(0);
        theme.isPaused = false;
        theme.handleSettingsChanged({ detail: { reducedMotion: true } });
        move({ clientX: 900, clientY: 100 });
        expect(theme.pointer.x).toBe(0);
    });
});

describe('Winter theme: capture flags', () => {
    it('reads its capture flags from the URL and freezes the simulation on a fixed time', async () => {
        const [kept, dropped] = [WINTER_PARTS.slice(0, 2), WINTER_PARTS.slice(2)];
        expect(dropped.length).toBeGreaterThan(0);
        const { theme } = await startTheme({
            quality: 'Low', search: `?winterTime=42&winterParts=${kept.join(', ')}&winterFalseColor=1`,
        });
        expect(theme.flags).toEqual({
            time: 42, fixedDt: null, parts: kept, falseColor: true, forceWebGL: false,
        });
        expect(theme.world.time).toBe(42);
        expect(theme.world.capture).toBe(true);
        // Only the named parts are drawn.
        const drawn = Object.entries(theme.world.parts);
        expect(drawn.length).toBeGreaterThan(kept.length);
        for (const [name, part] of drawn) expect(part.mesh.visible, name).toBe(kept.includes(name));
        theme.stepFrame(16);
        theme.stepFrame(1016);
        expect(theme.world.time).toBe(42);
        expect(theme.post.uTime.value).toBe(42);
        // Gameplay still lands on a frozen frame (the layout watch runs on wall time).
        const lock = vi.spyOn(theme.world, 'onLock');
        const layout = vi.spyOn(theme.world, 'setLayout');
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.resize(1000, 700);
        theme.stepFrame(1032);
        expect(lock).toHaveBeenCalledOnce();
        expect(layout).toHaveBeenCalledOnce();
    });

    it.each([
        ['?winterFalseColor', true], ['?winterFalseColor=on', true], ['?winterFalseColor=YES', true],
        ['?winterFalseColor=2', false], ['?winterFalseColor=off', false], ['', false],
    ])('reads the switch in %j as %s', (search, expected) => {
        stubBrowser({ search });
        expect(new WinterTheme().flags.falseColor).toBe(expected);
    });

    it('steps a fixed frame when asked, whatever the wall clock does', async () => {
        const { theme } = await startTheme({ quality: 'Low', search: '?winterFixedDt=20' });
        expect(theme.flags).toMatchObject({ time: null, fixedDt: 0.02, parts: null });
        expect(theme.world.capture).toBe(true);
        theme.stepFrame(0);
        theme.stepFrame(3);
        theme.stepFrame(5000);
        expect(theme.world.time).toBeCloseTo(0.06, 12);
    });

    it('takes a fixed step of a second or less as seconds', async () => {
        const { theme } = await startTheme({ quality: 'Low', search: '?winterFixedDt=0.025' });
        expect(theme.flags.fixedDt).toBe(0.025);
    });

    it('ignores capture flags that make no sense, and runs on the wall clock without them', async () => {
        const { theme } = await startTheme({
            quality: 'Low', search: '?winterTime=-3&winterFixedDt=abc&winterParts=&winterFalseColor=0',
        });
        expect(theme.flags).toEqual({
            forceWebGL: false, time: null, fixedDt: null, parts: null, falseColor: false,
        });
        expect(theme.world.capture).toBe(false);
        expect(Object.values(theme.world.parts).every((part) => part.mesh.visible)).toBe(true);
        theme.stepFrame(1000);
        theme.stepFrame(1010);
        expect(theme.world.time).toBeCloseTo(1 / 60 + 0.01, 9);
        // A stall is clamped: the night never jumps.
        theme.stepFrame(9000);
        expect(theme.world.time).toBeCloseTo(1 / 60 + 0.01 + 0.05, 9);
    });

    it('does not answer to the flags of the theme it was ported from', async () => {
        const { theme } = await startTheme({
            quality: 'Low',
            search: '?himalayanTime=42&himalayanFixedDt=20&himalayanParts=sky&himalayanFalseColor=1'
                + '&himalayanForceWebGL=1',
        });
        expect(theme.flags).toEqual({
            forceWebGL: false, time: null, fixedDt: null, parts: null, falseColor: false,
        });
    });

    it('does not answer to the flags of the theme it replaces', async () => {
        const { theme } = await startTheme({
            gpu: true, quality: 'Low', search: `?${RETIRED_FLAGS.map((flag) => `${flag}=1`).join('&')}`,
        });
        expect(theme.flags).toEqual({
            forceWebGL: false, time: null, fixedDt: null, parts: null, falseColor: false,
        });
        // No legacy scene, no stripped one, no bypassed post: the one world on the backend it found.
        expect(theme.isWebGPU).toBe(true);
        expect(theme.world).toBeInstanceOf(WinterWorld);
        expect(theme.post).toBeTruthy();
        expect(theme.world.capture).toBe(false);
        expect(Object.values(theme.world.parts).every((part) => part.mesh.visible)).toBe(true);
    });
});

describe('Winter theme: recovery and teardown', () => {
    it('retries once on the WebGL2 backend when the GPU device is lost', async () => {
        const { theme } = await startTheme({ gpu: true, quality: 'Low' });
        expect(theme.setupRendererResilience).toHaveBeenCalledWith(theme.renderer, {
            webgpuDevice: theme.renderer.backend.device,
        });
        expect(mocks.surfaces).toHaveLength(1);
        const [registration] = mocks.surfaces;
        expect(registration.label).toBe('winter');
        await registration.surface.recover();
        expect(mocks.instances).toHaveLength(2);
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.world).toBeTruthy();
        expect(mocks.loadGhosts).toHaveBeenCalledTimes(2);
        expect(registration.unregister).toHaveBeenCalledOnce();
        // On WebGL2 there is no device to watch and no second surface to register.
        expect(theme.setupRendererResilience).toHaveBeenLastCalledWith(theme.renderer, { webgpuDevice: null });
        expect(mocks.surfaces).toHaveLength(1);
        // A second loss is not retried: the coordinator routes out.
        await expect(registration.surface.recover()).rejects.toThrow(/already attempted/);
        expect(mocks.instances).toHaveLength(2);
    });

    it('retires its renderer and its monitors exactly once, and survives a second stop', async () => {
        const { theme, win } = await startTheme({ gpu: true, quality: 'High' });
        const published = theme.renderer;
        const { world, post } = theme;
        const disposeWorld = vi.spyOn(world, 'dispose');
        const disposePost = vi.spyOn(post, 'dispose');
        const listening = win.addEventListener.mock.calls.length;
        expect(listening).toBeGreaterThan(0);
        theme.disposeRuntime();
        theme.disposeRuntime();
        expect(theme.removeRendererResilience).toHaveBeenCalled();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(published, { nullInstance: false });
        expect(disposeWorld).toHaveBeenCalledOnce();
        expect(disposePost).toHaveBeenCalledOnce();
        expect(mocks.surfaces[0].unregister).toHaveBeenCalledOnce();
        // Every window listener it added is removed again.
        expect(win.removeEventListener).toHaveBeenCalledTimes(listening);
        expect(cancelAnimationFrame).toHaveBeenCalled();
        for (const key of [
            'renderer', 'scene', 'camera', 'world', 'post', 'passThrough', 'director', 'modeManager', 'ghostSource',
        ]) {
            expect(theme[key], key).toBeNull();
        }
        expect(theme.isWebGPU).toBe(false);
        expect(theme.eventUnsubscribers).toEqual([]);
        expect(await theme.whenCriticalReady()).toBe(false);
        expect(theme.getDiagnostics()).toMatchObject({
            world: null, ghosts: null, pixelRatio: null, droppedEvents: 0,
        });
        // A late bus event, a late frame or a late resize after retirement is harmless.
        expect(() => {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { effectQuality: 'Low' } });
            eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 640, height: 480 });
            theme.stepFrame(16);
            theme.resize(640, 480);
            theme.resetSession();
            theme.handleGameOver();
        }).not.toThrow();
    });

    it('retires its monitors on a direct stop, before the renderer goes', async () => {
        const { theme } = await startTheme({ gpu: true, quality: 'Low' });
        const published = theme.renderer;
        // (setupRendererResilience is a double here: this is the monitor it would have left.)
        const unmonitor = vi.fn();
        theme._resilienceUnsubs = [unmonitor];
        theme.lifecycleState = 'running';
        theme.stop();
        theme.stop();
        expect(unmonitor).toHaveBeenCalledOnce();
        expect(theme._resilienceUnsubs).toBeNull();
        expect(theme.removeRendererResilience).toHaveBeenCalled();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(published, { nullInstance: false });
        // A dispose is not a loss: the monitors were let go while the device was still there.
        const [unmonitored] = theme.removeRendererResilience.mock.invocationCallOrder;
        const [disposed] = theme.disposeRenderer.mock.invocationCallOrder;
        expect(unmonitored).toBeLessThan(disposed);
        expect(mocks.surfaces[0].unregister).toHaveBeenCalledOnce();
    });

    it('carries on when a world or a post refuses to be disposed', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        vi.spyOn(theme.world, 'dispose').mockImplementation(() => { throw new Error('stuck'); });
        vi.spyOn(theme.post, 'dispose').mockImplementation(() => { throw new Error('stuck too'); });
        expect(() => theme.disposeRuntime()).not.toThrow();
        expect(console.warn).toHaveBeenCalledWith('[Winter] World dispose failed:', expect.any(Error));
        expect(console.warn).toHaveBeenCalledWith('[Winter] Post dispose failed:', expect.any(Error));
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
    });

    it('stops and cleans up through the lifecycle, leaving nothing running', async () => {
        const { theme, container } = await startTheme({ gpu: true, quality: 'Low' });
        const { world } = theme;
        theme.lifecycleState = 'running';
        theme.stop();
        expect(theme.lifecycleState).toBe('stopped');
        expect(theme.isActive).toBe(false);
        expect(world.disposed).toBe(true);
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(container.classList.remove).toHaveBeenCalledWith('active');
        expect(() => theme.stop()).not.toThrow();
        theme.cleanup();
        theme.cleanup();
        expect(theme.cleanupComplete).toBe(true);
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        // A cleaned-up theme does not start again.
        await expect(theme.start(null)).rejects.toThrow(/cannot restart/);
    });

    it('drops a scene whose start was superseded while the renderer initialised', async () => {
        stubBrowser({ gpu: true, quality: 'High' });
        const theme = createTheme();
        const generation = theme.lifecycleGeneration;
        mocks.initialize = () => { theme.lifecycleGeneration += 1; };
        await theme.createScene(generation);
        expect(theme.renderer).toBeNull();
        expect(theme.world).toBeNull();
        expect(mocks.loadGhosts).not.toHaveBeenCalled(); // nothing is read for a start nobody owns
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });

    it('lets the newest of two overlapping starts win', async () => {
        stubBrowser({ gpu: true, quality: 'High' });
        const theme = createTheme();
        let release = null;
        mocks.initialize = (renderer) => (renderer === mocks.instances[0]
            ? new Promise((resolve) => { release = resolve; })
            : undefined);
        const first = theme.createScene(theme.lifecycleGeneration);
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        // A second build (a quality change, a recovery) starts while the first is still initialising.
        await theme.createScene(theme.lifecycleGeneration);
        const winner = theme.world;
        expect(theme.renderer).toBe(mocks.instances[1]);
        release();
        await first;
        // The late renderer is retired, never mounted over the running scene.
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.world).toBe(winner);
        expect(winner.disposed).toBe(false);
        expect(mocks.loadGhosts).toHaveBeenCalledOnce();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });
});
