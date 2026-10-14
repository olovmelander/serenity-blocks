/* eslint-disable max-classes-per-file */
/**
 * Luminous Tides — the theme class: the lifecycle, the renderer, the gameplay wiring, the layout
 * watch, the capture flags and the live parameters, run on a mocked node renderer against a world
 * and a post that are doubles. The doubles keep to what the two promise the theme (their
 * constructor arguments, their methods, the world's getState(), its public `combo` and the wheel
 * of nights it hands over on a rebuild): the picture itself is tested with the world.
 * The last block holds the real world and post to the same contract (it needs no GPU: the node
 * graphs are built, never compiled); it skips itself until both modules exist.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import LuminousTidesTheme from '../../src/themes/luminous-tides/luminous-tides-theme.js';
import { LUMINOUS_TIDES_TETROMINOS } from '../../src/themes/luminous-tides/luminous-tides-tetrominos.js';
import {
    LuminousTidesWorld, REST_RIG, fovForAspect,
} from '../../src/themes/luminous-tides/luminous-tides-world.js';
import { POST_LOOK } from '../../src/themes/luminous-tides/luminous-tides-post.js';
import {
    PLAYER_SLOTS, REST_RIG as COMPOSITION_RIG, fovForAspect as compositionFov,
} from '../../src/themes/luminous-tides/luminous-tides-composition.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';
import { THEME_URL_PARAMETERS } from '../../src/ui/url-parameters/theme-parameters.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const themeDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'luminous-tides',
);

/** The six tiers, lowest first. */
const QUALITY_NAMES = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];

/** What the theme calls on its world (plus the wheel it carries across a rebuild). */
const WORLD_METHODS = [
    'build', 'bindCamera', 'showOnlyParts', 'setViewport', 'setLayout', 'setReducedMotion', 'seek', 'resetSession',
    'updateCamera', 'onLock', 'onClear', 'onCombo', 'levelUp', 'update', 'getPostState', 'getState', 'dispose',
    'wheelTarget', 'restoreWheel',
];
const POST_METHODS = ['update', 'setCalmRects', 'setSize', 'render', 'dispose'];

const mocks = vi.hoisted(() => ({
    initialize: null,
    instances: [],
    failPost: 0,
    failPassThrough: 0,
    surfaces: [],
    worlds: [],
    posts: [],
    /** The parts the world draws and ?luminousTidesParts names. */
    parts: ['sky', 'shore', 'land', 'glows', 'rain'],
}));
vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        // Only the real post stack (the last block) builds one: nothing here has a GPU to render with.
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
                this.compute = vi.fn();
                this.render = vi.fn();
                this.init = vi.fn(async () => mocks.initialize?.(this));
                mocks.instances.push(this);
            }
        },
    };
});
// The world double: it keeps the numbers the real one reports, and notes what it was built with.
vi.mock('../../src/themes/luminous-tides/luminous-tides-world.js', () => ({
    LUMINOUS_TIDES_PARTS: Object.freeze([...mocks.parts]),
    REST_RIG: Object.freeze({ near: 0.5, far: 6000 }),
    fovForAspect: (aspect) => (aspect >= 1 ? 42 : 42 + (1 - aspect) * 20),
    LuminousTidesWorld: class {
        constructor(params) {
            mocks.worlds.push({ ...params });
            this.quality = params.quality;
            this.combo = 0;
            this.level = 1;
            this.time = 0;
            this.restored = null;
            this.layoutLive = false;
            this.reducedMotion = false;
            this.counts = { locks: 0, clears: 0, quads: 0 };
            this.postState = { exposure: 1 };
        }

        build() { return this; }

        bindCamera(camera) { this.camera = camera; }

        showOnlyParts(parts) { this.parts = parts; }

        setViewport(width, height, aspect) { this.viewport = { width, height, aspect }; }

        setLayout(rects) { this.layoutLive = Boolean(rects); }

        setReducedMotion(on) { this.reducedMotion = on; }

        seek(time) { this.time = time; }

        resetSession() {
            this.combo = 0;
            this.level = 1;
            this.counts = { locks: 0, clears: 0, quads: 0 };
        }

        updateCamera() { return this; }

        update(sim) { this.time = sim.time; }

        onLock() { this.counts.locks += 1; }

        onClear(clear) {
            this.counts.clears += 1;
            if (clear.lines >= 4 || clear.perfect) this.counts.quads += 1;
        }

        onCombo(combo) { this.combo = combo; }

        levelUp(level) { this.level = level; }

        /** Where the wheel of nights is headed: the clock's own turn plus a step a level. */
        wheelTarget() { return this.restored ?? this.time / 100 + (this.level - 1); }

        restoreWheel(offset) { this.restored = offset; }

        getPostState() { return this.postState; }

        getState() {
            return {
                quality: this.quality,
                combo: this.combo,
                level: this.level,
                time: this.time,
                layoutLive: this.layoutLive,
                counts: { ...this.counts },
            };
        }

        dispose() { this.disposed = true; }
    },
}));
// The post double; it can be made to fail, like a pipeline the backend refuses.
vi.mock('../../src/themes/luminous-tides/luminous-tides-post.js', () => {
    const look = (tier) => Object.freeze({ tier });
    return {
        CALM_RECTS_MAX: 5,
        POST_LOOK: Object.freeze({
            Minimal: look('Minimal'),
            Low: look('Low'),
            Medium: look('Medium'),
            High: look('High'),
            Ultra: look('Ultra'),
            Extreme: look('Extreme'),
        }),
        LuminousTidesPost: class {
            constructor(renderer, scene, camera, params) {
                if (mocks.failPost > 0) {
                    mocks.failPost -= 1;
                    throw new Error('pipeline unavailable');
                }
                mocks.posts.push({
                    renderer, scene, camera, params: { ...params },
                });
            }

            update() { return this; }

            setCalmRects() { return this; }

            setSize() { return this; }

            render() { return this; }

            dispose() { this.disposed = true; }
        },
        createPassThroughPipeline: () => {
            if (mocks.failPassThrough > 0) {
                mocks.failPassThrough -= 1;
                throw new Error('pipeline unavailable');
            }
            return { render() {}, dispose() {} };
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

const owners = [];
function createTheme() {
    const theme = new LuminousTidesTheme();
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
        getElementById: (id) => (id === 'luminous-tides-theme' ? container : null),
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

/** What the world counts of the run so far. */
const counts = (theme) => theme.world.getState().counts;

/**
 * Note every setCalmRects() the theme makes on its post. The theme reuses its rect list, so each
 * call is copied as it is made.
 */
function watchCalmZones(theme) {
    const calls = [];
    vi.spyOn(theme.post, 'setCalmRects').mockImplementation((rects, strength) => {
        calls.push({ rects: rects.map((rect) => ({ ...rect })), strength });
    });
    return { calls, last: () => calls[calls.length - 1] };
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

/** Every .js source in the theme folder. */
const themeSources = () => readdirSync(themeDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, source: readFileSync(path.join(themeDir, name), 'utf8') }));

describe('Luminous Tides theme: one node renderer on both backends', () => {
    beforeEach(() => {
        mocks.initialize = null;
        mocks.instances.length = 0;
        mocks.surfaces.length = 0;
        mocks.worlds.length = 0;
        mocks.posts.length = 0;
        mocks.failPost = 0;
        mocks.failPassThrough = 0;
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
        const entry = THEME_REGISTRY.find(({ id }) => id === 'luminous-tides');
        expect(entry).toMatchObject({
            displayName: 'Luminous Tides',
            module: './luminous-tides/luminous-tides-theme.js',
            icon: './luminous-tides/luminous-tides-theme-icon.png',
        });
        expect(existsSync(path.join(themeDir, 'luminous-tides-theme-icon.png'))).toBe(true);
        expect(new LuminousTidesTheme().name).toBe('luminous-tides');
    });

    it('ships no classic shader material, no legacy WebGL, no MaterialX noise and no raw GL', () => {
        const sources = themeSources().map(({ source }) => source);
        // At least the composition, the director, the pieces, the core and the theme.
        expect(sources.length).toBeGreaterThanOrEqual(5);
        for (const source of sources) {
            expect(source).not.toMatch(/new\s+[\w$.]*ShaderMaterial\s*\(/);
            expect(source).not.toMatch(/new\s+[\w$.]*WebGLRenderer\s*\(/);
            expect(source).not.toMatch(/\bmx_\w+\s*[(,]/); // a DXC compile pathology
            expect(source).not.toMatch(/from 'three'/);
            // Absolute asset paths resolve to the filesystem root under file:// (packaged Electron).
            expect(source).not.toMatch(/['"`]\/(textures|assets|hdri)\//);
            expect(source).not.toMatch(/getContext\(\s*['"`](webgl|experimental-webgl)/);
            expect(source).not.toMatch(/gl\.(createProgram|createShader|bindFramebuffer)\(/);
        }
        // Nothing is loaded: every texture is baked.
        for (const source of sources) {
            expect(source).not.toMatch(/\b(TextureLoader|GLTFLoader|fetch)\s*\(|new\s+\w*Loader\s*\(/);
        }
        const others = readdirSync(themeDir).filter((name) => !name.endsWith('.js'));
        expect(others).toEqual(['luminous-tides-theme-icon.png']);
    });

    it('leaves nothing of the renderer it replaces: no composer, no second scene state, no raw context', () => {
        const all = themeSources();
        expect(readdirSync(themeDir).filter((name) => /\.(wgsl|glsl)$/.test(name))).toEqual([]);
        for (const { name, source } of all) {
            // The old theme drew through an EffectComposer on a classic WebGL renderer.
            expect(source, name)
                .not.toMatch(/EffectComposer|UnrealBloomPass|ShaderPass|RenderPass|compileComputeAsync/);
            // An ordinary three theme: the manager's own async session covers its pipelines (ADR-0020).
            expect(source, name).not.toMatch(/buildsPipelinesAsync|create(Render|Compute)Pipeline(Async)?\s*\(/);
            expect(source, name).not.toMatch(/getContext\s*\(|localStorage/);
            // Sizes come through VIEWPORT_RESIZED; the theme keeps its own clock.
            expect(source, name).not.toMatch(/addEventListener\(\s*['"`]resize['"`]/);
            expect(source, name).not.toMatch(/\bTHREE\.Clock\b|new\s+Clock\s*\(/);
        }
        expect(Object.getOwnPropertyDescriptor(LuminousTidesTheme.prototype, 'buildsPipelinesAsync')).toBeUndefined();
        const theme = new LuminousTidesTheme();
        expect(theme.buildsPipelinesAsync).toBeUndefined();
        // One renderer, one scene state: nothing of a dual-state shell (ADR-0010).
        const shell = ['webgpuState', 'webglState', 'composer', 'visual', 'gameplayFx', 'reactionDirector', 'overlay'];
        for (const key of shell) {
            expect(theme, key).not.toHaveProperty(key);
        }
    });

    it('lists its capture flags in the URL parameter reference', () => {
        const mine = THEME_URL_PARAMETERS.filter((entry) => entry.scope === 'Luminous Tides');
        expect(mine.map((entry) => entry.name).sort()).toEqual([
            'luminousTidesFalseColor', 'luminousTidesFixedDt', 'luminousTidesForceWebGL', 'luminousTidesParts',
            'luminousTidesTime',
        ]);
        const source = readFileSync(path.join(themeDir, 'luminous-tides-theme.js'), 'utf8');
        for (const entry of mine) {
            expect(entry.sources, entry.name).toContain('src/themes/luminous-tides/luminous-tides-theme.js');
            // The reference documents what the theme reads, under the name it reads it by.
            expect(source, entry.name).toContain(`'${entry.name}'`);
        }
        // Nothing under this prefix is listed but the five, and the generic switch is read by name.
        const prefixed = THEME_URL_PARAMETERS.filter((entry) => /^luminousTides/.test(entry.name));
        expect(prefixed.map((entry) => entry.name).sort()).toEqual(mine.map((entry) => entry.name).sort());
        expect(source).toContain("'forceWebGL'");
        const parts = mine.find((entry) => entry.name === 'luminousTidesParts');
        expect(parts.sources).toContain('src/themes/luminous-tides/luminous-tides-world.js');
        const listed = parts.values.replace(/^[^:]*:/, '').split(',').map((name) => name.trim());
        expect(listed.sort()).toEqual([...mocks.parts].sort());
    });

    it('uses the WebGL2 backend of the node renderer when there is no GPU', async () => {
        stubBrowser();
        const theme = createTheme();
        const renderer = await theme.createRenderer(theme.lifecycleGeneration);
        expect(mocks.instances).toHaveLength(1);
        expect(renderer.options.forceWebGL).toBe(true);
        expect(renderer.isWebGPURenderer).toBe(true);
    });

    it.each(['?forceWebGL=1', '?luminousTidesForceWebGL', '?luminousTidesForceWebGL=true'])(
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
    });

    it('builds the scene, keeps a single-output scene pass and parks nothing to warm', async () => {
        // The camera as the theme hands it over, before the world's rig moves it.
        const bound = [];
        const bind = vi.spyOn(LuminousTidesWorld.prototype, 'bindCamera').mockImplementation((camera) => {
            bound.push({
                fov: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far,
            });
        });
        const { theme, container } = await startTheme({ gpu: true, quality: 'High' });
        expect(theme.renderer).toBe(mocks.instances[0]);
        expect(theme.isWebGPU).toBe(true);
        expect(container.replaceChildren).toHaveBeenCalledOnce(); // the container starts empty
        expect(container.appendChild).toHaveBeenCalledWith(theme.renderer.domElement);
        expect(theme.renderer.setClearColor).toHaveBeenCalledWith(0x03050c, 1);
        // Tone mapping happens once, in the post stack.
        expect(theme.renderer.toneMapping).toBe(THREE.NoToneMapping);
        // The canvas only receives the output quad: the scene pass owns depth and MSAA.
        expect(theme.renderer.options).toMatchObject({ antialias: false, depth: false, alpha: false });
        expect(theme.world).toBeTruthy();
        expect(theme.post).toBeTruthy();
        expect(theme.passThrough).toBeNull();
        expect(theme.director).toBeTruthy();
        expect(await theme.whenCriticalReady()).toBe(true);
        expect(theme.usesMrtScenePass()).toBe(false);
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(theme.getTetrominoConfig()).toBe(LUMINOUS_TIDES_TETROMINOS);
        expect(theme.getDiagnostics()).toMatchObject({
            backend: 'WebGPU',
            quality: 'High',
            droppedEvents: 0,
            reducedMotion: false,
            world: { quality: 'High', combo: 0, counts: { locks: 0, clears: 0, quads: 0 } },
        });
        // One world, built for this scene and this tier; one post, over the same scene and
        // camera, with the tier's look.
        expect(mocks.worlds).toHaveLength(1);
        expect(mocks.worlds[0].scene).toBe(theme.scene);
        expect(mocks.worlds[0]).toMatchObject({ quality: 'High', capture: false });
        expect(mocks.posts).toHaveLength(1);
        expect(mocks.posts[0].renderer).toBe(theme.renderer);
        expect(mocks.posts[0].scene).toBe(theme.scene);
        expect(mocks.posts[0].camera).toBe(theme.camera);
        expect(mocks.posts[0].params.look).toBe(POST_LOOK.High);
        expect(mocks.posts[0].params.falseColor).toBe(false);
        // The camera stands on the rig the shore is composed for, and the world is handed it.
        expect(bind).toHaveBeenCalledOnce();
        expect(bind).toHaveBeenCalledWith(theme.camera);
        expect(bound[0].fov).toBeCloseTo(fovForAspect(1280 / 720), 9);
        expect(bound[0].aspect).toBeCloseTo(1280 / 720, 9);
        expect(bound[0].near).toBe(REST_RIG.near);
        expect(bound[0].far).toBe(REST_RIG.far);
        // The loop is running.
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        expect(console.log).toHaveBeenCalledWith('[Luminous Tides] Scene ready (WebGPU, High)');
    });

    it('builds the same scene on the WebGL2 backend', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        expect(theme.isWebGPU).toBe(false);
        expect(theme.getDiagnostics().backend).toBe('WebGL2');
        expect(theme.post).toBeTruthy();
        const render = vi.spyOn(theme.post, 'render');
        expect(() => theme.stepFrame(16)).not.toThrow();
        expect(render).toHaveBeenCalledOnce();
        expect(theme.renderer.compute).not.toHaveBeenCalled();
        expect(mocks.surfaces).toHaveLength(0); // WebGL2 recovers through the context-restored restart
    });

    it('updates the world every frame before the post draws, and draws the canvas only through the post', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const update = vi.spyOn(theme.world, 'update');
        const render = vi.spyOn(theme.post, 'render');
        stepFrames(theme, 3);
        expect(update).toHaveBeenCalledTimes(3);
        expect(render).toHaveBeenCalledTimes(3);
        for (let frame = 0; frame < 3; frame++) {
            expect(update.mock.calls[frame][1]).toBe(theme.camera);
            expect(update.mock.invocationCallOrder[frame]).toBeLessThan(render.mock.invocationCallOrder[frame]);
        }
        expect(theme.renderer.render).not.toHaveBeenCalled();
    });

    it.each(PIXEL_RATIO_CAPS)('builds the %s tier and caps its pixel ratio at %s', async (quality, cap) => {
        stubBrowser({ quality });
        const theme = createTheme();
        const ratio = vi.spyOn(theme, 'getEffectivePixelRatio');
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.quality).toBe(quality);
        expect(mocks.worlds[0].quality).toBe(quality);
        expect(theme.world.getState().quality).toBe(quality);
        expect(mocks.posts[0].params.look).toBe(POST_LOOK[quality]);
        expect(ratio).toHaveBeenCalledWith(cap, 'theme');
        expect(theme.renderer.setPixelRatio).toHaveBeenCalledWith(ratio.mock.results[0].value);
        expect(theme.renderer.getPixelRatio()).toBeLessThanOrEqual(cap);
        expect(() => theme.stepFrame(16)).not.toThrow();
    });

    it('has a cap for every tier, the cap rising with the tier', () => {
        const tiers = PIXEL_RATIO_CAPS.map(([quality]) => quality);
        expect(tiers).toEqual(QUALITY_NAMES);
        expect(Object.keys(POST_LOOK).sort()).toEqual([...QUALITY_NAMES].sort());
        for (let i = 1; i < PIXEL_RATIO_CAPS.length; i++) {
            expect(PIXEL_RATIO_CAPS[i][1]).toBeGreaterThan(PIXEL_RATIO_CAPS[i - 1][1]);
        }
    });

    it('falls back to a pass-through pipeline when the post stack cannot be built', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failPost = 1;
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.post).toBeNull();
        expect(theme.passThrough).toBeTruthy();
        expect(theme.renderer.toneMapping).toBe(THREE.AgXToneMapping);
        const render = vi.spyOn(theme.passThrough, 'render');
        expect(() => stepFrames(theme, 3)).not.toThrow();
        expect(render).toHaveBeenCalledTimes(3);
        expect(() => theme.handleSettingsChanged({ detail: { reducedMotion: true } })).not.toThrow();
        const dispose = vi.spyOn(theme.passThrough, 'dispose');
        theme.disposeRuntime();
        expect(dispose).toHaveBeenCalledOnce();
        expect(theme.passThrough).toBeNull();
    });

    it('rejects a start whose picture cannot be drawn at all, leaving nothing behind', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failPost = 1;
        mocks.failPassThrough = 1; // the post stack and its pass-through fallback
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const dispose = vi.spyOn(LuminousTidesWorld.prototype, 'dispose');
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/pipeline unavailable/);
        expect(dispose).toHaveBeenCalledOnce(); // the world that was already built
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.scene).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });

    it('rejects a start whose world cannot be built, leaving nothing behind', async () => {
        stubBrowser({ quality: 'High' });
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(LuminousTidesWorld.prototype, 'build').mockImplementation(() => { throw new Error('no shore'); });
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/no shore/);
        expect(errors).toHaveBeenCalledWith('[Luminous Tides] Scene creation failed:', expect.any(Error));
        expect(mocks.posts).toHaveLength(0);
        for (const key of ['world', 'post', 'passThrough', 'director', 'renderer', 'scene', 'camera']) {
            expect(theme[key], key).toBeNull();
        }
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        expect(requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('stages gameplay on the bus and lands it on the next frame', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        expect(counts(theme)).toMatchObject({ locks: 0, clears: 0 }); // staged, not yet applied
        theme.stepFrame(16);
        expect(counts(theme)).toMatchObject({ locks: 1, clears: 1 });
        expect(theme.world.combo).toBe(1);

        // Paused: the bus is ignored, nothing is staged for later.
        theme.isPaused = true;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.isPaused = false;
        theme.stepFrame(32);
        expect(counts(theme).locks).toBe(1);
    });

    it('resolves the camera, then the staged gameplay, then the world, then the picture, each frame', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const updateCamera = vi.spyOn(theme.world, 'updateCamera');
        const flush = vi.spyOn(theme.director, 'flush');
        const lock = vi.spyOn(theme.world, 'onLock');
        const update = vi.spyOn(theme.world, 'update');
        const render = vi.spyOn(theme.post, 'render');
        for (let frame = 0; frame < 3; frame++) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            stepFrames(theme, 1);
            // Events aim through the camera of this frame and are in the world before it draws.
            const order = [updateCamera, flush, lock, update, render].map((spy) => spy.mock.invocationCallOrder[frame]);
            expect(order).toEqual([...order].sort((a, b) => a - b));
            expect(updateCamera.mock.calls[frame][0]).toBe(theme.camera);
        }
        expect(lock).toHaveBeenCalledTimes(3);
    });

    it('carries a hard drop, a four-line clear and a new level through the director to the shore', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const lock = vi.spyOn(theme.world, 'onLock');
        const clear = vi.spyOn(theme.world, 'onClear');
        const levelUp = vi.spyOn(theme.world, 'levelUp');
        eventBus.emit(EVENTS.HARD_DROP, { piece: I, distance: 12 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        theme.stepFrame(16);
        // One harder lock, in the piece's colour, at its column and row.
        expect(lock).toHaveBeenCalledOnce();
        expect(lock.mock.calls[0][0]).toMatchObject({
            hardDrop: true, color: LUMINOUS_TIDES_TETROMINOS.colors.I, rows: [19], player: 0,
        });
        expect(lock.mock.calls[0][0].u).toBeCloseTo(0.8, 6);
        expect(clear).toHaveBeenCalledOnce();
        expect(clear.mock.calls[0][0]).toMatchObject({
            lines: 4, rows: [19, 18, 17, 16], tspin: false, perfect: false, player: 0,
        });
        expect(levelUp).toHaveBeenCalledOnce();
        expect(levelUp).toHaveBeenCalledWith(3);
        expect(counts(theme)).toMatchObject({ locks: 1, clears: 1, quads: 1 });
        expect(theme.world.getState()).toMatchObject({ level: 3, combo: 1 });
        expect(theme.level).toBe(3);
    });

    it('carries a T-spin and a perfect clear to the shore on the clear they belong to', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const clear = vi.spyOn(theme.world, 'onClear');
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 2 });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 1 });
        expect(() => stepFrames(theme, 30)).not.toThrow();
        expect(clear).toHaveBeenCalledOnce();
        expect(clear.mock.calls[0][0]).toMatchObject({ lines: 2, tspin: true, perfect: true });
        expect(counts(theme).clears).toBe(1);
    });

    it('hands the post what the shore asks of it, then the clock, each frame', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const state = vi.spyOn(theme.world, 'getPostState');
        const update = vi.spyOn(theme.post, 'update');
        const render = vi.spyOn(theme.post, 'render');
        theme.stepFrame(16);
        // Two calls a frame: what the world says, then the clock; then the picture is drawn.
        expect(update).toHaveBeenCalledTimes(2);
        expect(state.mock.results.map((result) => result.value)).toContain(update.mock.calls[0][0]);
        expect(update.mock.calls[1][0]).toEqual({ time: theme.time });
        expect(render).toHaveBeenCalledOnce();
        expect(render.mock.invocationCallOrder[0]).toBeGreaterThan(update.mock.invocationCallOrder[1]);

        // The post is told every frame, and the clock it is given is the theme's.
        const frames = 40;
        expect(() => stepFrames(theme, frames)).not.toThrow();
        expect(update).toHaveBeenCalledTimes(2 * (1 + frames));
        expect(render).toHaveBeenCalledTimes(1 + frames);
        expect(update).toHaveBeenLastCalledWith({ time: theme.time });
        expect(theme.time).toBeCloseTo((1 + frames) / 60, 9);
        expect(theme.world.getState().time).toBeCloseTo(theme.time, 9);
    });

    it('lights the surf to the longest chain on any board', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const combo = vi.spyOn(theme.world, 'onCombo');
        theme.reportCombo(2, 1);
        theme.reportCombo(5, 2);
        expect(theme.world.combo).toBe(5);
        theme.reportCombo(0, 2);
        expect(theme.world.combo).toBe(2);
        theme.reportCombo(0, 1);
        expect(theme.world.combo).toBe(0);
        expect(combo.mock.calls.map(([n]) => n)).toEqual([2, 5, 2, 0]);
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
        expect(theme.world.combo).toBe(3);
        expect(theme.world.getState().combo).toBe(3);
    });

    it('honours the reaction settings', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const reduced = vi.spyOn(theme.world, 'setReducedMotion');
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(counts(theme).locks).toBe(0);
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: true, pieceLockRipple: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        theme.stepFrame(32);
        expect(counts(theme)).toMatchObject({ locks: 0, clears: 1 });
        theme.handleSettingsChanged({ detail: { reducedMotion: true } });
        expect(reduced).toHaveBeenLastCalledWith(true);
        expect(theme.getDiagnostics().reducedMotion).toBe(true);
        // Every shape a settings payload arrives in.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { reducedMotion: false }, source: 'menu' });
        expect(reduced).toHaveBeenLastCalledWith(false);
        expect(theme.reducedMotion).toBe(false);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'reducedMotion', value: 'true' });
        expect(reduced).toHaveBeenLastCalledWith(true);
        expect(theme.reducedMotion).toBe(true);
    });

    it('starts with the settings already saved, and with the system\'s reduced-motion preference', async () => {
        const reduced = vi.spyOn(LuminousTidesWorld.prototype, 'setReducedMotion');
        const seek = vi.spyOn(LuminousTidesWorld.prototype, 'seek');
        const saved = await startTheme({ quality: 'Low', settings: { pieceLockRipple: false, reducedMotion: 'on' } });
        expect(saved.theme.reducedMotion).toBe(true);
        expect(reduced).toHaveBeenLastCalledWith(true);
        // The world knows before the theme stands it at its first frame.
        expect(reduced.mock.invocationCallOrder[0])
            .toBeLessThan(seek.mock.invocationCallOrder[seek.mock.calls.length - 1]);
        expect(saved.theme.director.lockRipple).toBe(false);
        expect(saved.theme.director.enabled).toBe(true);
        saved.theme.disposeRuntime();

        reduced.mockClear();
        const system = await startTheme({ quality: 'Low', reducedMotion: true });
        expect(system.theme.reducedMotion).toBe(true);
        expect(reduced).toHaveBeenLastCalledWith(true);
        // The setting cannot switch off what the system asks for.
        system.theme.handleSettingsChanged({ detail: { reducedMotion: false } });
        expect(system.theme.reducedMotion).toBe(true);
        expect(reduced).toHaveBeenLastCalledWith(true);
        expect(() => stepFrames(system.theme, 30)).not.toThrow();
    });

    it('puts the shore back at rest when a run ends', async () => {
        const { theme, listeners } = await startTheme({ quality: 'High' });
        for (let i = 0; i < 3; i++) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            theme.stepFrame(16 * (i + 1));
        }
        expect(theme.world.combo).toBe(3);
        expect(counts(theme)).toMatchObject({ locks: 3, clears: 3 });
        const reset = vi.spyOn(theme.world, 'resetSession');
        listeners.get('gameOver')();
        expect(reset).toHaveBeenCalledOnce();
        expect(theme.world.getState()).toMatchObject({
            combo: 0, counts: { locks: 0, clears: 0, quads: 0 },
        });
        expect(theme.combos.size).toBe(0);
        expect(theme.level).toBe(1);
        expect(theme.director.slots.every((slot) => !slot.assigned)).toBe(true);
        // The next run's first clear is a chain of one again.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        theme.stepFrame(64);
        expect(theme.world.combo).toBe(1);
    });

    it('carries the level, the clock and the wheel of nights across a quality rebuild', async () => {
        const restore = vi.spyOn(LuminousTidesWorld.prototype, 'restoreWheel');
        const { theme } = await startTheme({ quality: 'High' });
        expect(restore).not.toHaveBeenCalled(); // a fresh start turns the wheel from the clock alone
        const silent = vi.spyOn(LuminousTidesWorld.prototype, 'levelUp');
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        stepFrames(theme, 30);
        expect(theme.level).toBe(3);
        const clock = theme.time;
        expect(clock).toBeGreaterThan(0);
        const first = theme.world;
        const wheel = first.wheelTarget();
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        await Promise.resolve();
        await vi.waitFor(() => expect(theme.quality).toBe('Low'));
        await vi.waitFor(() => expect(theme.world?.getState().quality).toBe('Low'));
        // The new shore is on the same level, the same clock and the same night, not back at the start.
        expect(theme.world).not.toBe(first);
        expect(theme.level).toBe(3);
        expect(silent).toHaveBeenLastCalledWith(3, { silent: true });
        expect(theme.world.getState()).toMatchObject({ level: 3 });
        expect(theme.time).toBeGreaterThanOrEqual(clock);
        expect(restore).toHaveBeenCalledOnce();
        expect(restore).toHaveBeenCalledWith(wheel);
        expect(theme.world.wheelTarget()).toBe(wheel);
        // The wheel is put back after the silent level-up, so the level's own turn cannot undo it.
        expect(restore.mock.invocationCallOrder[0]).toBeGreaterThan(silent.mock.invocationCallOrder.at(-1));
        expect(theme.carry).toBeNull();
    });

    it('keeps its clock through a rebuild in place and clears it when it stops', async () => {
        const restore = vi.spyOn(LuminousTidesWorld.prototype, 'restoreWheel');
        const { theme } = await startTheme({ quality: 'High' });
        stepFrames(theme, 40);
        const clock = theme.time;
        expect(clock).toBeGreaterThan(0);
        // A lost device rebuilds in place: the night goes on from where it was.
        theme.carry = { time: theme.time, level: theme.level };
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.time).toBe(clock);
        expect(theme.world.time).toBe(clock);
        // A carry with no wheel in it (a world that could not say) leaves the wheel to the clock.
        expect(restore).not.toHaveBeenCalled();
        // A stop ends the night: the next start begins it again.
        theme.stop();
        expect(theme.carry).toBeNull();
        expect(theme.time).toBe(0);
    });

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
        const retire = vi.spyOn(first, 'dispose');
        win.settings.effectQuality = 'Minimal';
        theme.handleSettingsChanged({ detail: { effectQuality: 'Minimal' } });
        // The rebuild is queued a microtask later and builds a whole world: wait for it.
        await vi.waitFor(() => expect(theme.world?.getState().quality).toBe('Minimal'), { timeout: 4000 });
        expect(theme.quality).toBe('Minimal');
        expect(theme.world).not.toBe(first);
        expect(retire).toHaveBeenCalledOnce();
        expect(theme.pendingQuality).toBeNull();
        expect(mocks.instances).toHaveLength(2);
        expect(mocks.worlds.map(({ quality }) => quality)).toEqual(['High', 'Minimal']);
        expect(mocks.posts[1].params.look).toBe(POST_LOOK.Minimal);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        // One set of listeners, not two: a lock lands once.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(counts(theme).locks).toBe(1);
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
        // Resumed only to be rebuilt, the manager would watch a retired renderer and restart
        // the theme a second time: resume() hands it back and the manager restarts it once.
        expect(theme.resume()).toBe(false);
        await Promise.resolve();
        expect(rebuild).not.toHaveBeenCalled();
        expect(theme.rebuildPending).toBe(true);
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

    it('follows a resize once and tells the shore, the post and the director', async () => {
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
        // The shore is told the real buffer and the shape of the window.
        expect(viewport).toHaveBeenCalledOnce();
        expect(viewport).toHaveBeenCalledWith(Math.floor(800 * ratio), Math.floor(600 * ratio), 800 / 600);
        expect(post).toHaveBeenCalledOnce();
        expect(post).toHaveBeenCalledWith(800, 600, Math.floor(800 * ratio), Math.floor(600 * ratio));
        expect(theme.director.viewportWidth).toBe(800);
        expect(theme.director.viewportHeight).toBe(600);
        expect(() => theme.stepFrame(16)).not.toThrow();
        // Through the bus as well; nonsense is clamped to a pixel.
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 1024, height: 768 });
        expect(renderer.setSize).toHaveBeenLastCalledWith(1024, 768, false);
        expect(() => theme.resize(NaN, -5)).not.toThrow();
        expect(renderer.setSize).toHaveBeenLastCalledWith(1, 1, false);
        expect(() => theme.stepFrame(32)).not.toThrow();
    });

    it('follows a drawing buffer that something else resized', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        stepFrames(theme, 1);
        const viewport = vi.spyOn(theme.world, 'setViewport');
        const post = vi.spyOn(theme.post, 'setSize');
        stepFrames(theme, 2);
        expect(viewport).not.toHaveBeenCalled(); // nothing changed: nothing is re-told
        // The adaptive render scale (or a capture tool) reaches into the renderer directly.
        theme.renderer.size = { width: 640, height: 360 };
        stepFrames(theme, 2);
        const ratio = theme.renderer.getPixelRatio();
        expect(viewport).toHaveBeenCalledOnce();
        expect(viewport).toHaveBeenCalledWith(Math.floor(640 * ratio), Math.floor(360 * ratio), 1280 / 720);
        expect(post).toHaveBeenCalledOnce();
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

    it('reads the board on frame time, aims the shore at it and calms the post over the card', async () => {
        const { theme, page, win } = await startTheme({ quality: 'High' });
        const manager = { handlers: new Map(), off: vi.fn() };
        manager.on = vi.fn((name, handler) => {
            manager.handlers.set(name, handler);
            return manager.off;
        });
        win.serenityBlocks = { gameModeManager: manager };
        const setLayout = vi.spyOn(theme.world, 'setLayout');
        const calm = watchCalmZones(theme);
        // Nothing on screen: the shore aims at where the solo board would hang, the post is not calmed.
        stepFrames(theme, 2);
        expect(setLayout).toHaveBeenCalledOnce();
        expect(setLayout).toHaveBeenLastCalledWith(null);
        expect(theme.world.getState().layoutLive).toBe(false);
        expect(theme.layout).toMatchObject({ applied: null, live: false });
        expect(calm.calls).toHaveLength(2);
        expect(calm.last()).toEqual({ rects: [], strength: 0 });
        // The mode manager turned up after the build: the theme subscribes once.
        expect([...manager.handlers.keys()].sort()).toEqual(['modeActivated', 'modeStarted', 'modeStopped']);

        // A mode starts: a card, its board and the HUD appear.
        page.cards = [box(440, 40, 400, 640)];
        page.canvas = box(490, 150, 300, 500);
        page.hud = box(900, 200, 140, 320);
        stepFrames(theme, 5);
        expect(setLayout).toHaveBeenCalledOnce(); // no polling: the next read is on a schedule
        expect(theme.world.getState().layoutLive).toBe(false);
        manager.handlers.get('modeStarted')();
        stepFrames(theme, 1);
        expect(setLayout).toHaveBeenCalledTimes(2);
        const [rects] = setLayout.mock.calls[1];
        const card = {
            x0: 440 / 1280, y0: 40 / 720, x1: 840 / 1280, y1: 680 / 720,
        };
        const hud = {
            x0: 900 / 1280, y0: 200 / 720, x1: 1040 / 1280, y1: 520 / 720,
        };
        expect(rects).toMatchObject({ cardCount: 1, cards: [card], hud });
        expect(rects.boards[0].x0).toBeCloseTo(490 / 1280, 9);
        expect(theme.world.getState().layoutLive).toBe(true);
        expect(theme.layout.live).toBe(true);
        // The calm zones ease in over the card and the HUD.
        expect(calm.last().rects).toEqual([card, hud]);
        const easing = calm.last().strength;
        expect(easing).toBeGreaterThan(0);
        expect(easing).toBeLessThan(0.5);
        stepFrames(theme, 240);
        expect(calm.last().strength).toBeGreaterThan(0.99);
        // The board plays the shore through the live layout.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        stepFrames(theme, 1);
        expect(counts(theme).locks).toBe(1);

        // The mode ends: the run is forgotten, the board is gone, the calm zones fade on the last rects.
        page.cards = [];
        page.canvas = null;
        page.hud = null;
        const reset = vi.spyOn(theme.world, 'resetSession');
        manager.handlers.get('modeStopped')();
        expect(reset).toHaveBeenCalledOnce();
        stepFrames(theme, 1);
        expect(setLayout).toHaveBeenLastCalledWith(null);
        expect(theme.world.getState().layoutLive).toBe(false);
        expect(theme.layout.live).toBe(false);
        expect(theme.layout.applied).toBeTruthy();
        expect(calm.last().rects).toEqual([card, hud]);
        expect(calm.last().strength).toBeLessThan(1);
        stepFrames(theme, 300);
        expect(calm.last().strength).toBeLessThan(0.01);
        // Teardown lets go of the manager.
        theme.disposeRuntime();
        expect(manager.off).toHaveBeenCalledTimes(3);
        expect(theme.modeManager).toBeNull();
    });

    it('calms four cards and the HUD at most', async () => {
        const { theme, page } = await startTheme({ quality: 'Low' });
        const calm = watchCalmZones(theme);
        page.cards = [0, 1, 2, 3, 4].map((i) => box(20 + i * 250, 100, 220, 500));
        page.hud = box(40, 620, 300, 60);
        stepFrames(theme, 1);
        const { rects } = calm.last();
        expect(rects).toHaveLength(PLAYER_SLOTS);
        expect(rects[0].x0).toBeCloseTo(20 / 1280, 9);
        expect(rects[PLAYER_SLOTS - 2].x0).toBeCloseTo(770 / 1280, 9);
        expect(rects[PLAYER_SLOTS - 1]).toEqual({
            x0: 40 / 1280, y0: 620 / 720, x1: 340 / 1280, y1: 680 / 720,
        });
    });

    it('leans the view with the pointer, but not for a touch, a paused theme or reduced motion', async () => {
        const { theme, listeners } = await startTheme({ quality: 'Low' });
        const updateCamera = vi.spyOn(theme.world, 'updateCamera');
        stepFrames(theme, 1);
        expect(updateCamera.mock.calls[0][1]).toMatchObject({ pointerX: 0, pointerY: 0 });
        const move = listeners.get('pointermove');
        move({ clientX: 1280, clientY: 360, pointerType: 'mouse' });
        expect(theme.pointer).toMatchObject({ x: 1, y: 0 });
        stepFrames(theme, 60);
        // Eased, never snapped: the world's rig is handed the eased pointer.
        expect(theme.pointer.sx).toBeGreaterThan(0.5);
        expect(theme.pointer.sx).toBeLessThan(1);
        const [camera, sim] = updateCamera.mock.calls[updateCamera.mock.calls.length - 1];
        expect(camera).toBe(theme.camera);
        expect(sim.pointerX).toBe(theme.pointer.sx);
        expect(sim.pointerY).toBe(0);
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

    it('reads its capture flags from the URL and freezes the simulation on a fixed time', async () => {
        const show = vi.spyOn(LuminousTidesWorld.prototype, 'showOnlyParts');
        const seek = vi.spyOn(LuminousTidesWorld.prototype, 'seek');
        const { theme } = await startTheme({
            quality: 'Low',
            search: '?luminousTidesTime=42&luminousTidesParts=shore,%20glows&luminousTidesFalseColor=1',
        });
        expect(theme.flags).toEqual({
            time: 42, fixedDt: null, parts: ['shore', 'glows'], falseColor: true, forceWebGL: false,
        });
        // The world is told it is being captured and where its clock stands; the post shows its debug view.
        expect(mocks.worlds[0].capture).toBe(true);
        expect(mocks.posts[0].params.falseColor).toBe(true);
        expect(show).toHaveBeenCalledOnce();
        expect(show).toHaveBeenCalledWith(['shore', 'glows']);
        expect(seek).toHaveBeenLastCalledWith(42);
        expect(theme.world.getState().time).toBe(42);
        const update = vi.spyOn(theme.world, 'update');
        const post = vi.spyOn(theme.post, 'update');
        theme.stepFrame(16);
        theme.stepFrame(1016);
        expect(theme.time).toBe(42);
        expect(theme.world.getState().time).toBe(42);
        expect(update.mock.calls.every(([sim]) => sim.time === 42 && sim.delta === 0)).toBe(true);
        expect(post).toHaveBeenLastCalledWith({ time: 42 });
        // Gameplay still lands on a frozen frame (the layout watch runs on wall time).
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(1032);
        expect(counts(theme).locks).toBe(1);
    });

    it('steps a fixed frame when asked, whatever the wall clock does', async () => {
        const { theme } = await startTheme({ quality: 'Low', search: '?luminousTidesFixedDt=20' });
        expect(theme.flags).toMatchObject({ time: null, fixedDt: 0.02, parts: null });
        expect(mocks.worlds[0].capture).toBe(true);
        theme.stepFrame(0);
        theme.stepFrame(3);
        theme.stepFrame(5000);
        expect(theme.time).toBeCloseTo(0.06, 12);
        expect(theme.world.getState().time).toBeCloseTo(0.06, 12);
        // A step of one or less is read as seconds, a larger one as milliseconds.
        stubBrowser({ search: '?luminousTidesFixedDt=0.25' });
        expect(new LuminousTidesTheme().flags.fixedDt).toBe(0.25);
    });

    it('ignores capture flags that make no sense, and runs on the wall clock without them', async () => {
        const show = vi.spyOn(LuminousTidesWorld.prototype, 'showOnlyParts');
        const { theme } = await startTheme({
            quality: 'Low',
            search: '?luminousTidesTime=-3&luminousTidesFixedDt=abc&luminousTidesParts=&luminousTidesFalseColor=0',
        });
        expect(theme.flags).toEqual({
            forceWebGL: false, time: null, fixedDt: null, parts: null, falseColor: false,
        });
        expect(mocks.worlds[0].capture).toBe(false);
        expect(mocks.posts[0].params.falseColor).toBe(false);
        expect(show).not.toHaveBeenCalled(); // every part is drawn
        theme.stepFrame(1000);
        theme.stepFrame(1010);
        expect(theme.world.getState().time).toBeCloseTo(1 / 60 + 0.01, 9);
        // A stall is clamped: the shore never jumps.
        theme.stepFrame(9000);
        expect(theme.world.getState().time).toBeCloseTo(1 / 60 + 0.01 + 0.05, 9);
    });

    it('retries once on the WebGL2 backend when the GPU device is lost, on the same night', async () => {
        const restore = vi.spyOn(LuminousTidesWorld.prototype, 'restoreWheel');
        const { theme } = await startTheme({ gpu: true, quality: 'Low' });
        expect(theme.setupRendererResilience).toHaveBeenCalledWith(theme.renderer, {
            webgpuDevice: theme.renderer.backend.device,
        });
        expect(mocks.surfaces).toHaveLength(1);
        const [registration] = mocks.surfaces;
        expect(registration.label).toBe('luminous-tides');
        stepFrames(theme, 20);
        const lost = theme.world;
        const wheel = lost.wheelTarget();
        await registration.surface.recover();
        expect(mocks.instances).toHaveLength(2);
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.world).toBeTruthy();
        // The new world is built for the new renderer, never the lost one, and picks the wheel up.
        expect(mocks.worlds).toHaveLength(2);
        expect(theme.world).not.toBe(lost);
        expect(restore).toHaveBeenCalledExactlyOnceWith(wheel);
        expect(registration.unregister).toHaveBeenCalledOnce();
        // On WebGL2 there is no device to watch and no second surface to register.
        expect(theme.setupRendererResilience).toHaveBeenLastCalledWith(theme.renderer, { webgpuDevice: null });
        expect(mocks.surfaces).toHaveLength(1);
        expect(() => stepFrames(theme, 2)).not.toThrow();
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
        // The post goes before the world it reads, and both before the renderer they draw with.
        expect(disposePost.mock.invocationCallOrder[0]).toBeLessThan(disposeWorld.mock.invocationCallOrder[0]);
        expect(disposeWorld.mock.invocationCallOrder[0])
            .toBeLessThan(theme.disposeRenderer.mock.invocationCallOrder[0]);
        expect(mocks.surfaces[0].unregister).toHaveBeenCalledOnce();
        // Every window listener it added is removed again.
        expect(win.removeEventListener).toHaveBeenCalledTimes(listening);
        expect(cancelAnimationFrame).toHaveBeenCalled();
        for (const key of ['renderer', 'scene', 'camera', 'world', 'post', 'passThrough', 'director', 'modeManager']) {
            expect(theme[key], key).toBeNull();
        }
        expect(theme.isWebGPU).toBe(false);
        expect(theme.eventUnsubscribers).toEqual([]);
        expect(await theme.whenCriticalReady()).toBe(false);
        expect(theme.getDiagnostics()).toMatchObject({ world: null, pixelRatio: null, droppedEvents: 0 });
        // A late bus event, a late frame, a late setting or a late resize after retirement is harmless.
        expect(() => {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { effectQuality: 'Low' } });
            eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 640, height: 480 });
            theme.handleSettingsChanged({ detail: { reducedMotion: true } });
            theme.stepFrame(16);
            theme.resize(640, 480);
            theme.resetSession();
        }).not.toThrow();
        expect(world.reducedMotion).toBe(false); // the retired world is not written to
    });

    it('still retires the renderer when the world or the post fails to let go', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const published = theme.renderer;
        vi.spyOn(theme.post, 'dispose').mockImplementation(() => { throw new Error('post stuck'); });
        vi.spyOn(theme.world, 'dispose').mockImplementation(() => { throw new Error('world stuck'); });
        expect(() => theme.disposeRuntime()).not.toThrow();
        expect(console.warn).toHaveBeenCalledWith('[Luminous Tides] Post dispose failed:', expect.any(Error));
        expect(console.warn).toHaveBeenCalledWith('[Luminous Tides] World dispose failed:', expect.any(Error));
        expect(theme.disposeRenderer).toHaveBeenCalledWith(published, { nullInstance: false });
        expect(theme.world).toBeNull();
        expect(theme.post).toBeNull();
        expect(theme.renderer).toBeNull();
    });

    it('stops and cleans up through the lifecycle, leaving nothing running', async () => {
        const { theme, container } = await startTheme({ gpu: true, quality: 'Low' });
        const retire = vi.spyOn(theme.world, 'dispose');
        theme.lifecycleState = 'running';
        theme.stop();
        expect(theme.lifecycleState).toBe('stopped');
        expect(theme.isActive).toBe(false);
        expect(retire).toHaveBeenCalledOnce();
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(container.classList.remove).toHaveBeenCalledWith('active');
        expect(() => theme.stop()).not.toThrow();
        theme.cleanup();
        theme.cleanup();
        expect(theme.cleanupComplete).toBe(true);
        expect(retire).toHaveBeenCalledOnce();
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
        expect(mocks.worlds).toHaveLength(0); // no world was built for a start nobody is waiting for
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
        const retire = vi.spyOn(winner, 'dispose');
        expect(theme.renderer).toBe(mocks.instances[1]);
        release();
        await first;
        // The late renderer is retired, never mounted over the running scene.
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.world).toBe(winner);
        expect(retire).not.toHaveBeenCalled();
        expect(mocks.worlds).toHaveLength(1);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });
});

// ── the real world and post, held to the contract the doubles above stand in for ──────────────
const worldFile = path.join(themeDir, 'luminous-tides-world.js');
const postFile = path.join(themeDir, 'luminous-tides-post.js');
const qualityFile = path.join(themeDir, 'luminous-tides-quality.js');
const realModules = existsSync(worldFile) && existsSync(postFile) && existsSync(qualityFile);

describe.skipIf(!realModules)('Luminous Tides theme: the real world and post', () => {
    it('export what the theme imports and implement every method it calls', async () => {
        const world = await vi.importActual('../../src/themes/luminous-tides/luminous-tides-world.js');
        const post = await vi.importActual('../../src/themes/luminous-tides/luminous-tides-post.js');
        const quality = await vi.importActual('../../src/themes/luminous-tides/luminous-tides-quality.js');
        expect(world.LuminousTidesWorld).toBeTypeOf('function');
        for (const method of WORLD_METHODS) {
            expect(world.LuminousTidesWorld.prototype[method], `LuminousTidesWorld.${method}`).toBeTypeOf('function');
        }
        // The rig and the lens are the composition's own, handed on by the world.
        expect(world.REST_RIG).toBe(COMPOSITION_RIG);
        expect(world.fovForAspect).toBe(compositionFov);
        expect(world.REST_RIG.near).toBeGreaterThan(0);
        expect(world.REST_RIG.far).toBeGreaterThan(world.REST_RIG.near);
        for (const aspect of [0.46, 1, 16 / 9, 21 / 9]) {
            const fov = world.fovForAspect(aspect);
            expect(fov, `fovForAspect(${aspect})`).toBeGreaterThan(1);
            expect(fov, `fovForAspect(${aspect})`).toBeLessThan(179);
        }
        expect(post.LuminousTidesPost).toBeTypeOf('function');
        for (const method of POST_METHODS) {
            expect(post.LuminousTidesPost.prototype[method], `LuminousTidesPost.${method}`).toBeTypeOf('function');
        }
        expect(post.createPassThroughPipeline).toBeTypeOf('function');
        // Six tiers, a cap and a look for each: bloom from Medium, none built below it.
        expect([...quality.QUALITY_NAMES].sort()).toEqual([...QUALITY_NAMES].sort());
        expect(Object.keys(post.POST_LOOK)).toEqual(expect.arrayContaining(QUALITY_NAMES));
        QUALITY_NAMES.forEach((tier, i) => {
            expect(post.POST_LOOK[tier], tier).toBeTypeOf('object');
            expect(post.POST_LOOK[tier].bloom, tier).toBe(i >= 2);
        });
    });

    it('draw the parts the URL parameter reference lists for ?luminousTidesParts', async () => {
        const world = await vi.importActual('../../src/themes/luminous-tides/luminous-tides-world.js');
        const entry = THEME_URL_PARAMETERS.find(({ name }) => name === 'luminousTidesParts');
        expect(entry, 'the captureThemes row for luminous-tides').toBeTruthy();
        const listed = entry.values.replace(/^[^:]*:/, '').split(',').map((name) => name.trim());
        expect(world.LUMINOUS_TIDES_PARTS, 'luminous-tides-world.js exports LUMINOUS_TIDES_PARTS')
            .toBeInstanceOf(Array);
        expect(listed.sort()).toEqual([...world.LUMINOUS_TIDES_PARTS].sort());
    });

    // No GPU is needed: the node graphs are built, never compiled (the pipeline is a double).
    it.each(QUALITY_NAMES)('take a %s start, frames of gameplay and a teardown, called as the theme calls them', async (
        quality,
    ) => {
        const { LuminousTidesWorld: World, REST_RIG: rig, fovForAspect: fov } = await vi.importActual(
            '../../src/themes/luminous-tides/luminous-tides-world.js',
        );
        const { LuminousTidesPost: Post, POST_LOOK: looks, createPassThroughPipeline } = await vi.importActual(
            '../../src/themes/luminous-tides/luminous-tides-post.js',
        );
        const load = vi.spyOn(THREE.TextureLoader.prototype, 'load');
        const request = vi.fn();
        vi.stubGlobal('fetch', request);
        const renderer = new THREE.WebGPURenderer({ forceWebGL: true });
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(fov(16 / 9), 16 / 9, rig.near, rig.far);
        const sim = {
            time: 0, delta: 0, pointerX: 0, pointerY: 0,
        };
        const card = {
            x0: 0.4, y0: 0.05, x1: 0.6, y1: 0.95,
        };
        const layout = {
            cardCount: 1,
            cards: [card],
            hud: {
                x0: 0.65, y0: 0.25, x1: 0.76, y1: 0.75,
            },
            boards: [{
                x0: 0.42, y0: 0.2, x1: 0.58, y1: 0.92,
            }, null, null, null, null],
        };
        try {
            // createScene: build, bind, post, size, settings, the first pose.
            const world = new World({ scene, quality, capture: false });
            expect(world.build()).toBe(world);
            world.bindCamera(camera);
            const post = new Post(renderer, scene, camera, { look: looks[quality], falseColor: false });
            world.setViewport(1280, 720, 16 / 9);
            post.setSize(1280, 720, 1280, 720);
            world.setReducedMotion(false);
            world.seek(0);
            world.updateCamera(camera, sim);
            world.update(sim, camera);
            // What it draws is node materials only, and nothing was asked of the network.
            const materials = [];
            scene.traverse((object) => { if (object.material) materials.push(object.material); });
            expect(materials.length).toBeGreaterThan(0);
            expect(materials.every((m) => m.isNodeMaterial && !m.isShaderMaterial)).toBe(true);
            // The scene never grows after build: every pool is drawn from the first frame.
            const children = scene.children.length;
            // stepFrame: layout, camera, the director's sink (its contexts, in its order), world, post.
            world.setLayout(null);
            const postState = world.getPostState();
            for (let frame = 1; frame <= 4; frame++) {
                sim.time = frame / 60;
                sim.delta = 1 / 60;
                if (frame === 2) world.setLayout(layout);
                world.updateCamera(camera, sim);
                if (frame === 1) {
                    world.levelUp(2);
                    world.onLock({
                        player: 0, rows: [19], u: 0.8, hardDrop: true, color: '#FFB23E', screen: null,
                    });
                    world.onClear({
                        player: 0,
                        rows: [19, 18, 17, 16],
                        lines: 4,
                        combo: 1,
                        cascade: 1,
                        tspin: false,
                        perfect: false,
                        b2b: true,
                        screen: null,
                    });
                    world.onCombo(1);
                }
                if (frame === 3) {
                    // A board on screen, a T-spin, another player's board, a perfect clear.
                    world.onLock({
                        player: 2, rows: [3, 4], u: 0.2, hardDrop: false, color: null, screen: null,
                    });
                    world.onClear({
                        player: 0,
                        rows: [18, 19],
                        lines: 2,
                        combo: 2,
                        cascade: 1,
                        tspin: true,
                        perfect: true,
                        b2b: false,
                        screen: null,
                    });
                    world.onCombo(2);
                }
                if (frame === 4) {
                    // A meditation click: a screen position and no board.
                    world.onClear({
                        player: 0,
                        rows: [],
                        lines: 1,
                        combo: 3,
                        cascade: 1,
                        tspin: false,
                        perfect: false,
                        b2b: false,
                        screen: { x: 0.3, y: 0.6 },
                    });
                    world.onCombo(0);
                }
                world.update(sim, camera);
                post.setCalmRects([card], 0.5);
                expect(world.getPostState()).toBe(postState); // one reused object, never a new one per frame
                post.update(postState);
                post.update({ time: sim.time });
                post.render();
            }
            expect(scene.children.length).toBe(children);
            expect(world.getState()).toMatchObject({ quality });
            // A rebuild in place: the wheel of nights is handed over and taken back after a silent level.
            const wheel = world.wheelTarget();
            expect(Number.isFinite(wheel), 'wheelTarget() is a number').toBe(true);
            world.levelUp(3, { silent: true });
            world.restoreWheel(wheel);
            world.update(sim, camera);
            // Captures and a new run.
            world.showOnlyParts(['sky']);
            world.resetSession();
            world.setReducedMotion(true);
            world.update(sim, camera);
            expect(load).not.toHaveBeenCalled();
            expect(request).not.toHaveBeenCalled();
            // disposeRuntime: the post, then the world (twice is harmless).
            post.dispose();
            world.dispose();
            world.dispose();
            // The fallback the theme draws through when the post stack cannot be built.
            const passThrough = createPassThroughPipeline(renderer, scene, camera);
            expect(passThrough.render).toBeTypeOf('function');
            expect(passThrough.dispose).toBeTypeOf('function');
            passThrough.dispose();
        } finally {
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
        }
    }, 30000);
});
