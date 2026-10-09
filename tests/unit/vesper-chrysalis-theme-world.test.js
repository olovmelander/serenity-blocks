/* eslint-disable max-classes-per-file */
/**
 * Vesper Chrysalis — the theme on its REAL world and its REAL post stack.
 *
 * vesper-chrysalis-theme.test.js runs the theme against doubles of its world, post and core (the
 * contract it calls them by). This file is the other half: the same theme class with the modules
 * on disk, so a call the doubles accept and the real world does not have, a material that is not
 * a node material, or a file the scene would have to download, fails here.
 *
 * Only the renderer and the render pipeline are stood in for (there is no GPU in a unit test).
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import VesperChrysalisTheme from '../../src/themes/vesper-chrysalis/vesper-chrysalis-theme.js';
import {
    REST_RIG, VESPER_PARTS, VesperWorld, fovForAspect,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-world.js';
import {
    POST_LOOK, VesperPost, createPassThroughPipeline,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-post.js';
import {
    VESPER_PALETTES, WING_FALL, approach, wingForCombo,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-core.js';
import { QUALITY_NAMES } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-quality.js';
import { URL_PARAMETER_CATALOG } from '../../src/ui/url-parameters/catalog.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

// Every start builds the real world (a noise field, a plan, some twenty node materials).
vi.setConfig({ testTimeout: 60000 });

const here = path.dirname(fileURLToPath(import.meta.url));
const themeDir = path.resolve(here, '..', '..', 'src', 'themes', 'vesper-chrysalis');
const effectFile = 'src/playground/effects/vesper-chrysalis.effect.js';
const effectSource = () => readFileSync(path.resolve(here, '..', '..', effectFile), 'utf8');
const themeFiles = () => readdirSync(themeDir).filter((name) => name.endsWith('.js'));
const sourceOf = (name) => readFileSync(path.join(themeDir, name), 'utf8');

const mocks = vi.hoisted(() => ({ instances: [], pipelines: [] }));
vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        RenderPipeline: class {
            constructor(renderer) {
                this.renderer = renderer;
                this.render = vi.fn();
                this.dispose = vi.fn();
                mocks.pipelines.push(this);
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
                // A renderer keeps its clear colour: the world borrows it for the mirror pass.
                this.clear = { color: new actual.Color(0x000000), alpha: 1 };
                this.setClearColor = vi.fn((color, alpha = 1) => {
                    this.clear.color.set(color);
                    this.clear.alpha = alpha;
                });
                this.getClearColor = (target) => target.copy(this.clear.color);
                this.getClearAlpha = () => this.clear.alpha;
                this.setPixelRatio = vi.fn((ratio) => { this.pixelRatio = ratio; });
                this.getPixelRatio = () => this.pixelRatio;
                this.setSize = vi.fn((width, height) => { this.size = { width, height }; });
                this.getDrawingBufferSize = (target) => target.set(
                    Math.floor(this.size.width * this.pixelRatio),
                    Math.floor(this.size.height * this.pixelRatio),
                );
                this.render = vi.fn();
                this.init = vi.fn(async () => {});
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
    registerGpuSurface: () => vi.fn(),
}));

const owners = [];
function createTheme() {
    const theme = new VesperChrysalisTheme();
    theme.isActive = true;
    theme.cleanupComplete = false;
    vi.spyOn(theme, 'disposeRenderer').mockResolvedValue();
    vi.spyOn(theme, 'setupRendererResilience').mockImplementation(() => {});
    vi.spyOn(theme, 'removeRendererResilience');
    vi.spyOn(theme, 'initializeRendererCandidate').mockImplementation(async (renderer) => {
        await renderer.init();
        return renderer;
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

function stubBrowser({ gpu = true, search = '', quality = 'Low' } = {}) {
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
        settings: { effectQuality: quality, graphicsQuality: quality },
        addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
        removeEventListener: vi.fn(),
        matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', {
        getElementById: (id) => (id === 'vesper-chrysalis-theme' ? container : null),
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

const T = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
};
const I = {
    shape: [[1, 1, 1, 1]], x: 6, y: 23, type: 'I',
};

/** A piece that locks and clears a line, as the game announces it. */
function clearingPiece(piece, hardDrop = false) {
    if (hardDrop) eventBus.emit(EVENTS.HARD_DROP, { piece, distance: 12 });
    eventBus.emit(EVENTS.PIECE_LOCK, { piece });
    eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
}

/** Every method the theme's source calls on one of its collaborators. */
function calledOn(object) {
    const source = sourceOf('vesper-chrysalis-theme.js');
    const found = source.matchAll(new RegExp(`\\b${object}\\??\\.(\\w+)(?:\\?\\.)?\\(`, 'g'));
    return [...new Set([...found].map((m) => m[1]))].sort();
}

describe('Vesper Chrysalis theme on its real world', () => {
    beforeEach(() => {
        mocks.instances.length = 0;
        mocks.pipelines.length = 0;
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

    it('finds on the real world, post stack and core every call and export the theme uses', () => {
        // The world: every method the theme calls, and the hook it calls if it is there.
        const world = calledOn('world');
        expect(world.length).toBeGreaterThan(10);
        for (const method of ['build', ...world]) {
            expect(typeof VesperWorld.prototype[method], `VesperWorld.${method}`).toBe('function');
        }
        expect(world).toContain('onGameOver');
        // The post stack, and the fallback that stands in for it.
        const post = calledOn('post');
        expect(post.length).toBeGreaterThan(3);
        for (const method of post) expect(typeof VesperPost.prototype[method], `VesperPost.${method}`).toBe('function');
        const fallback = createPassThroughPipeline({}, new THREE.Scene(), new THREE.PerspectiveCamera());
        for (const method of calledOn('passThrough')) expect(typeof fallback[method], method).toBe('function');
        // The rig the camera is built from, a look for every tier, and the easing the calm zones use.
        expect(REST_RIG.near).toBeGreaterThan(0);
        expect(REST_RIG.far).toBeGreaterThan(REST_RIG.near);
        expect(fovForAspect(16 / 9)).toBeGreaterThan(0);
        expect(Object.keys(POST_LOOK).sort()).toEqual([...QUALITY_NAMES].sort());
        expect(approach(3, 0)).toBe(0);
        // What the post is handed each frame is what the world reports.
        expect(sourceOf('vesper-chrysalis-theme.js')).toMatch(/post\.update\(world\.getPostState\(\)\)/);
    });

    it('builds the real scene and runs it: a frame, a piece that clears, a chain, a new level', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const { world } = theme;
        expect(world).toBeInstanceOf(VesperWorld);
        expect(theme.post).toBeInstanceOf(VesperPost);
        expect(theme.passThrough).toBeNull();
        expect(console.warn).not.toHaveBeenCalled();
        expect(world.getState()).toMatchObject({
            quality: 'High', combo: 0, level: 1, layoutLive: false,
        });
        expect(theme.getDiagnostics().world).toEqual(world.getState());
        // The camera is the world's rig, and it sees what stands in the scene.
        expect(theme.camera.fov).toBeCloseTo(fovForAspect(1280 / 720), 6);
        expect(theme.camera.near).toBe(REST_RIG.near);
        expect(theme.camera.far).toBe(REST_RIG.far);
        expect(theme.scene.children).toEqual([world.root]);
        // The mirror pass clears to nothing; the canvas itself is never seen through.
        expect(theme.renderer.clear.alpha).toBe(0);
        expect(() => stepFrames(theme, 3)).not.toThrow();
        expect(mocks.pipelines.at(-1).render).toHaveBeenCalledTimes(3);
        expect(world.time).toBeCloseTo(3 / 60, 9);
        expect(world.u.viewport.value.x).toBeGreaterThan(0);

        // A hard-dropped piece that clears a line: three moths, a swell, the first step of the wings.
        clearingPiece(I, true);
        expect(world.counts.locks).toBe(0); // staged on the bus, landed on the frame
        stepFrames(theme, 1);
        expect(world.counts).toMatchObject({
            locks: 1, clears: 1, moths: 3, quads: 0,
        });
        expect(world.combo).toBe(1);
        expect(world.blooms.pending.filter((e) => e.kind === 'strike')).toHaveLength(3);
        // The chain grows; the wings open with it; the lilies light as the moths land.
        for (let n = 2; n <= 4; n++) {
            stepFrames(theme, 40);
            clearingPiece(T);
            stepFrames(theme, 1);
            expect(world.combo).toBe(n);
        }
        stepFrames(theme, 240);
        expect(world.wing).toBe(wingForCombo(4));
        expect(world.getState().held).toBeGreaterThan(0);
        expect(theme.getDiagnostics().droppedEvents).toBe(0);
        // A piece that clears nothing ends the chain. The game says nothing when a lock clears
        // nothing, so the shared combo tracker can only tell at the lock after it: the break
        // reaches the world one piece late, and then the wings fall.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        stepFrames(theme, 2);
        expect(world.combo).toBe(4);
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        stepFrames(theme, 2);
        expect(world.combo).toBe(0);
        expect(world.counts.falls).toBe(1);
        expect(world.u.wing.value.z).toBeGreaterThan(0);
        // A new level moves the evening on, and the theme remembers it for a rebuild.
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        stepFrames(theme, 1);
        expect(world.getState()).toMatchObject({ level: 3, palette: VESPER_PALETTES[2].name });
        expect(theme.level).toBe(3);
        // Every number the post was handed is one it can use.
        const post = world.getPostState();
        for (const key of ['flash', 'kick', 'shafts', 'bloomBoost', 'exposure']) {
            expect(Number.isFinite(post[key]), key).toBe(true);
        }
    });

    it('lets the wings fall on game over, and comes back from a rebuild at the run\'s hour', async () => {
        const { theme, listeners } = await startTheme({ quality: 'Low' });
        for (let n = 1; n <= 5; n++) {
            clearingPiece(n % 2 ? I : T);
            stepFrames(theme, 30);
        }
        eventBus.emit(EVENTS.LEVEL_UP, { level: 4 });
        stepFrames(theme, 200);
        const first = theme.world;
        const open = first.wing;
        expect(open).toBe(wingForCombo(5));
        // A last piece, its moth still in the air when the run ends.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        stepFrames(theme, 1);
        const lit = first.getState().held;
        expect(lit).toBeGreaterThan(0);
        expect(first.blooms.pending.length).toBeGreaterThan(0);
        const scales = first.dust.cursor;
        const moths = first.moths.cursor;
        // The window's game-over: the world marks the ending, then the session is reset — in one go.
        listeners.get('gameOver')();
        expect(first.combo).toBe(0);
        expect(first.counts).toEqual({
            locks: 0, clears: 0, quads: 0, moths: 0, falls: 0,
        });
        expect(theme.level).toBe(0);
        // The reset is soft. Nothing on screen jumps: the wings are still there, to burn away,
        // shedding their scales; the lilies still hold their light, to fade; the moth flies on,
        // to a lily that will stay shut; the evening stays at its hour.
        expect(first.wing).toBe(open);
        expect(first.dust.cursor).toBeGreaterThan(scales);
        expect(first.getState().held).toBe(lit);
        expect(first.blooms.pending).toEqual([]);
        expect(first.moths.cursor).toBe(moths);
        expect(first.getState()).toMatchObject({ level: 4, palette: VESPER_PALETTES[3].name });
        stepFrames(theme, Math.round((WING_FALL * 60) / 2));
        expect(first.u.wing.value.x).toBe(open);
        expect(first.u.wing.value.z).toBeGreaterThan(0.3);
        expect(first.u.wing.value.z).toBeLessThan(0.7);
        expect(first.getState().held).toBeLessThan(lit);
        stepFrames(theme, Math.round(WING_FALL * 60));
        expect(first.wing).toBe(0);
        expect(first.u.wing.value.z).toBe(0);
        expect(first.getState().held).toBe(0);
        expect(theme.getDiagnostics().droppedEvents).toBe(0);

        // A new run reaches level 2; a new quality tier then builds a new world, at that level, quietly.
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        stepFrames(theme, 1);
        theme.handleSettingsChanged({ detail: { effectQuality: 'Medium' } });
        await vi.waitFor(() => expect(theme.world).not.toBe(first));
        await vi.waitFor(() => expect(theme.world?.getState().quality).toBe('Medium'));
        expect(first.disposed).toBe(true);
        expect(theme.world.getState()).toMatchObject({ level: 2, palette: VESPER_PALETTES[1].name });
        expect(theme.world.storm).toBe(0); // no ceremony
        expect(theme.scene.children).toEqual([theme.world.root]);
        expect(() => stepFrames(theme, 2)).not.toThrow();
    });

    it('lets the wings of a long chain fall when it breaks into a new one', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        const { world } = theme;
        for (let n = 1; n <= 3; n++) {
            clearingPiece(n % 2 ? I : T);
            stepFrames(theme, 30);
        }
        stepFrames(theme, 180);
        expect(world.wing).toBe(wingForCombo(3));
        // A piece that clears nothing (the game says nothing of it), then one that clears: the
        // world is told "1" after "3" — never "0" — and drops the old wings all the same.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        stepFrames(theme, 20);
        expect(world.combo).toBe(3);
        clearingPiece(I);
        stepFrames(theme, 1);
        expect(world.combo).toBe(1);
        expect(world.counts.falls).toBe(1);
        expect(world.u.wing.value.x).toBe(wingForCombo(3));
        stepFrames(theme, Math.round(WING_FALL * 60) + 240);
        expect(world.wing).toBe(wingForCombo(1));
        expect(world.u.wing.value.z).toBe(0);
    });

    // A chain of ONE that breaks and starts again goes 1 -> 0 -> 1 inside one lock of the shared
    // ComboTracker. The director says both — 0, then 1 — so that in the commonest rhythm of play
    // (a clear, a piece or two that clear nothing, a clear) the wings fall and are written anew
    // instead of standing at their first step for good.
    it('lets the wings of a chain of one fall when it breaks and the next piece starts another', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        const { world } = theme;
        clearingPiece(I);
        stepFrames(theme, 180);
        expect(world.wing).toBe(wingForCombo(1));
        const flashed = vi.spyOn(world, 'onCombo');
        for (let i = 0; i < 4; i++) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            stepFrames(theme, 40);
            clearingPiece(I);
            stepFrames(theme, 40);
        }
        // Four chains broke and four began: the world heard of it.
        expect(flashed).toHaveBeenCalled();
        expect(world.counts.falls).toBeGreaterThan(0);
    });

    it('aims the real world at the board on screen and answers a clear with blades from its card', async () => {
        const { theme, page } = await startTheme({ quality: 'Low' });
        stepFrames(theme, 1);
        expect(theme.world.getState().layoutLive).toBe(false);
        // The solo board appears; the theme's next scheduled read finds it.
        page.cards = [box(480, 40, 320, 640)];
        page.canvas = box(510, 110, 260, 520);
        theme.scheduleLayoutReads();
        stepFrames(theme, 1);
        expect(theme.world.getState().layoutLive).toBe(true);
        const fired = vi.spyOn(theme.world.blades, 'fire');
        const launched = vi.spyOn(theme.world.moths, 'launch');
        clearingPiece(T);
        stepFrames(theme, 1);
        expect(fired).toHaveBeenCalledOnce();
        const [ys, x0, x1] = fired.mock.calls[0];
        expect(x0).toBeCloseTo(480 / 1280, 9);
        expect(x1).toBeCloseTo(800 / 1280, 9);
        // The cleared row is the floor of the board on screen.
        expect(ys).toHaveLength(1);
        expect(ys[0]).toBeGreaterThan(110 / 720);
        expect(ys[0]).toBeLessThan(630 / 720);
        expect(ys[0]).toBeCloseTo((110 + 520 * (19.5 / 20)) / 720, 6);
        // The piece's moth left the card's edge on its side (a T at columns 3..5: the left).
        const [moth] = launched.mock.calls[0];
        const start = new THREE.Vector3(...moth.from).project(theme.camera);
        expect(start.x * 0.5 + 0.5).toBeCloseTo(480 / 1280, 3);
    });

    it.each(QUALITY_NAMES)('builds the %s tier from node materials only, under names of its own', async (quality) => {
        const { theme } = await startTheme({ quality });
        expect(theme.quality).toBe(quality);
        expect(theme.world.getState().quality).toBe(quality);
        const materials = [];
        theme.scene.traverse((object) => { if (object.material) materials.push(object.material); });
        expect(materials.length).toBeGreaterThanOrEqual(Object.keys(theme.world.parts).length);
        for (const material of materials) {
            expect(material.isNodeMaterial, material.name).toBe(true);
            expect(material.isShaderMaterial, material.name).not.toBe(true);
            expect(material.isRawShaderMaterial, material.name).not.toBe(true);
            // Named, so a capture or a profile can tell them apart.
            expect(material.name, material.type).toMatch(/^VesperChrysalis/);
        }
        for (const name of Object.keys(theme.world.parts)) expect(VESPER_PARTS).toContain(name);
        expect(() => stepFrames(theme, 2)).not.toThrow();
    });

    it('downloads nothing: the first frame is the finished picture', async () => {
        const loads = [
            vi.spyOn(THREE.TextureLoader.prototype, 'load'),
            vi.spyOn(THREE.ImageLoader.prototype, 'load'),
            vi.spyOn(THREE.FileLoader.prototype, 'load'),
            vi.spyOn(THREE.ImageBitmapLoader.prototype, 'load'),
        ];
        const fetched = vi.fn();
        vi.stubGlobal('fetch', fetched);
        const { theme } = await startTheme({ quality: 'Extreme' });
        clearingPiece(I, true);
        stepFrames(theme, 3);
        for (const load of loads) expect(load).not.toHaveBeenCalled();
        expect(fetched).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
        // The one texture the scene has is the noise field it baked itself.
        expect(theme.world.textures).toHaveLength(1);
        expect(theme.world.textures[0].isDataTexture).toBe(true);
        // And no module of the theme, nor the playground effect that mounts it, can: no loader, no
        // fetch, no image, model or environment file.
        const sources = themeFiles().map((name) => [name, sourceOf(name)]);
        sources.push([effectFile, effectSource()]);
        expect(sources.length).toBeGreaterThan(12);
        for (const [name, source] of sources) {
            expect(source, name).not.toMatch(/\b\w*Loader\s*\(|\.loadAsync\s*\(|\bfetch\s*\(|new\s+Image\s*\(/);
            expect(source, name).not.toMatch(/\.(png|jpe?g|webp|ktx2|hdr|exr|glb|gltf|bin)['"`]/i);
            expect(source, name).not.toMatch(/['"`]\/?(public\/)?(textures|assets|models|hdri)\//);
        }
    });

    // A shared uniform the world writes and no material (nor the post) reads is a reaction that
    // was meant and is not drawn — as a `shock` uniform once was, for a ring over the sky that
    // only the post's prism ring ever showed.
    it('leaves no shared uniform that no shader reads', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const shaders = themeFiles()
            .filter((name) => !/-(world|theme|director|composition|core|quality|tetrominos)\.js$/.test(name))
            .map(sourceOf)
            .join('\n');
        const shared = Object.keys(theme.world.u);
        expect(shared.length).toBeGreaterThan(30);
        const unread = shared
            .filter((key) => key !== 'noise') // the sampler the others read the noise texture through
            .filter((key) => !new RegExp(`\\bu\\.${key}\\b`).test(shaders));
        expect(unread).toEqual([]);
    });
});

describe('Vesper Chrysalis playground effect: its URL parameters', () => {
    const read = () => {
        const names = new Set();
        const pattern = /params\.(?:get|has)\('([A-Za-z]+)'\)|num\(params, '([A-Za-z]+)'/g;
        for (const match of effectSource().matchAll(pattern)) names.add(match[1] || match[2]);
        return names;
    };
    /** The names its docblock lists: `name=` at the start of a line or in passing, and the icon pose's. */
    const documented = () => {
        const [docblock] = /\/\*\*[\s\S]*?\*\//.exec(effectSource().replace(/^\/\*[^*].*\n/, ''));
        expect(docblock).toMatch(/URL params:/);
        const listed = docblock.slice(docblock.indexOf('URL params:'));
        const names = new Set();
        for (const match of listed.matchAll(/\b([a-z][A-Za-z]*)=/g)) names.add(match[1]);
        for (const match of listed.matchAll(/\b(icon[A-Z][A-Za-z]*)\b/g)) names.add(match[1]);
        return names;
    };

    it('reads every parameter its docblock names', () => {
        const code = read();
        const listed = [...documented()].sort();
        expect(listed.length).toBeGreaterThan(20);
        expect(listed.filter((name) => !code.has(name))).toEqual([]);
        // It mounts the world and the post the theme ships, and nothing of its own.
        const imports = [...effectSource().matchAll(/from '([^']+)'/g)].map((m) => m[1]);
        expect(imports.filter((from) => from !== 'three/webgpu').every((from) => (
            from.startsWith('../../themes/vesper-chrysalis/')
        ))).toBe(true);
        expect(imports).toContain('../../themes/vesper-chrysalis/vesper-chrysalis-world.js');
        expect(imports).toContain('../../themes/vesper-chrysalis/vesper-chrysalis-post.js');
    });

    it('names in its docblock every parameter it reads', () => {
        const listed = documented();
        expect([...read()].filter((name) => !listed.has(name))).toEqual([]);
    });

    it('is documented in the URL parameter reference, parameter for parameter, with the icon pose it rests on', () => {
        const code = read();
        expect(code.size).toBeGreaterThan(20);
        const entries = URL_PARAMETER_CATALOG.filter((entry) => entry.sources.includes(effectFile));
        expect(entries.map((entry) => entry.name).sort()).toEqual([...code].sort());
        for (const entry of entries) {
            expect(entry.scope, entry.name).toMatch(/\bvesper-chrysalis\b/);
            expect(entry.category, entry.name).toBe('Playground');
            // The old theme forwarded the page's URL to its effect; the new one reads only its own flags.
            expect(entry.scope, entry.name).not.toMatch(/game themes:[^;]*Vesper Chrysalis/);
        }
        // No entry anywhere still claims the theme forwards a playground parameter, or names a slice that is gone.
        for (const entry of URL_PARAMETER_CATALOG) {
            expect(entry.scope, entry.name).not.toMatch(/game themes:[^;]*Vesper Chrysalis/);
            expect(JSON.stringify(entry), entry.name).not.toMatch(/vesper-(lake|relic|sky|shore)/);
        }
        // The reference quotes the icon pose's defaults: they follow the effect when it is re-framed.
        const source = effectSource();
        const fallback = (name) => Number(new RegExp(`num\\(params, '${name}', (-?[0-9.]+)\\)`).exec(source)[1]);
        const quoted = (name) => entries.find((entry) => entry.name === name).defaultValue;
        expect(quoted('iconFov')).toContain(`Vesper Chrysalis ${fallback('iconFov')}`);
        expect(quoted('iconYaw')).toContain(`Vesper Chrysalis ${fallback('iconYaw')} radians`);
        expect(quoted('iconPitch')).toContain(`Vesper Chrysalis ${fallback('iconPitch')} radians`);
        // The events it can fire are the ones the reference lists for it.
        const fired = [...source.matchAll(/eventName === '(\w+)'/g)].map((m) => m[1]);
        const cues = entries.find((entry) => entry.name === 'event').values;
        const listedEvents = /Vesper Chrysalis: ([^;)]+)/.exec(cues)[1];
        expect(listedEvents.split(/,\s+/).sort()).toEqual([...new Set(fired)].sort());
    });
});
