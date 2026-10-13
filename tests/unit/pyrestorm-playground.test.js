/**
 * Pyrestorm — the playground effect: the same world and post the theme ships, mounted alone.
 *
 * `create()` is synchronous and hands back the playground contract at once; the land and the lava
 * bake asynchronously behind it (`getDiagnostics().assets` is 'loading' until the world is in, then
 * 'ready', or 'failed'). The bake is replaced here by one the test releases, fed from the real
 * synchronous preparation, so nothing waits on the page's frames.
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
// (Aliased: a binding named `meta` trips vitest's import rewrite next to import.meta.)
import { create, meta as effectMeta } from '../../src/playground/effects/pyrestorm.effect.js';
import { PyrestormWorld } from '../../src/themes/pyrestorm/pyrestorm-world.js';
import { TIMING } from '../../src/themes/pyrestorm/pyrestorm-core.js';
import { WALK, WATCHES } from '../../src/themes/pyrestorm/pyrestorm-hours.js';
import { PLAYGROUND_URL_PARAMETERS } from '../../src/ui/url-parameters/playground-parameters.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const FILE = 'src/playground/effects/pyrestorm.effect.js';
const source = readFileSync(new URL('../../src/playground/effects/pyrestorm.effect.js', import.meta.url), 'utf8');
const header = source.slice(source.indexOf('/**'), source.indexOf('*/', source.indexOf('/**')));
/** Every URL parameter the effect reads, by the name it reads it under. */
const reads = [...new Set([
    ...[...source.matchAll(/\bparams\.(?:get|has)\(\s*'([^']+)'\s*\)/g)].map((match) => match[1]),
    ...[...source.matchAll(/\bnum\(\s*params\s*,\s*'([^']+)'/g)].map((match) => match[1]),
])].sort();

let prepared;

beforeAll(() => {
    prepared = PyrestormWorld.prepareSync('Minimal');
});

const effects = [];

afterEach(() => {
    effects.splice(0).forEach((effect) => effect.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** A bake the test releases (or fails) when it chooses. */
function holdPrepare() {
    const held = {};
    held.promise = new Promise((resolve, reject) => {
        held.resolve = resolve;
        held.reject = reject;
    });
    held.spy = vi.spyOn(PyrestormWorld, 'prepare').mockImplementation(() => held.promise);
    return held;
}

/** Let the effect's `.then` run. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

function mount(query = '') {
    vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720 });
    const renderer = {
        toneMapping: THREE.NoToneMapping,
        getDrawingBufferSize: (size) => size.set(1280, 720),
        backend: { isWebGLBackend: true },
        info: { render: { calls: 7, triangles: 1234 } },
        render: vi.fn(),
    };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1280 / 720, 0.5, 25000);
    const effect = create({
        scene, camera, renderer, params: new URLSearchParams(`quality=Minimal&noPost=1&${query}`),
    });
    effects.push(effect);
    return {
        effect, renderer, scene, camera,
    };
}

/** Mount, release the bake, and wait for the world to be in. */
async function mountReady(query = '', seekTo = 40) {
    const held = holdPrepare();
    const mounted = mount(query);
    mounted.effect.seek(seekTo);
    held.resolve(prepared);
    await settle();
    return mounted;
}

describe('Pyrestorm playground effect', () => {
    it('names itself as the full world', () => {
        expect(effectMeta.id).toBe('pyrestorm');
        expect(effectMeta.title).toMatch(/Pyrestorm/);
        expect(typeof effectMeta.description).toBe('string');
        expect(effectMeta.description.length).toBeGreaterThan(10);
        expect(create).toBeTypeOf('function');
    });

    it('mounts the theme\'s own world and post, and nothing from outside the theme', () => {
        const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
        const theme = '../../themes/pyrestorm/';
        const outside = imports.filter((from) => from !== 'three/webgpu' && !from.startsWith(theme));
        expect(outside).toEqual([]);
        for (const module of ['world', 'post', 'composition']) {
            expect(source).toContain(`../../themes/pyrestorm/pyrestorm-${module}.js`);
        }
        expect(source.match(/new PyrestormWorld\(/g)).toHaveLength(1);
        expect(source).toMatch(/new PyrestormWorld\(\{[^}]*capture: true/);
        expect(source).toContain('PyrestormWorld.prepare(');
    });

    it('hands back the playground contract at once, and reports the bake as loading', () => {
        const held = holdPrepare();
        const { effect, renderer, scene } = mount();
        expect(held.spy).toHaveBeenCalledOnce();
        expect(held.spy.mock.calls[0][0]).toBe('Minimal');
        for (const method of ['update', 'seek', 'render', 'resize', 'getDiagnostics', 'dispose', 'camera']) {
            expect(effect[method], method).toBeTypeOf('function');
        }
        expect(effect.getDiagnostics()).toMatchObject({ assets: 'loading', settledFrames: 0, backend: 'WebGL2' });
        // Until the bake is in, frames go on without a world: the bare scene is drawn.
        expect(() => {
            effect.update(1, 1 / 60);
            effect.seek(40);
            effect.resize();
            effect.camera(1, new THREE.PerspectiveCamera());
            effect.render();
        }).not.toThrow();
        expect(renderer.render).toHaveBeenCalledWith(scene, expect.any(THREE.PerspectiveCamera));
        expect(scene.children).toHaveLength(0);
        expect(effect.getDiagnostics()).toMatchObject({ assets: 'loading', settledFrames: 0 });
    });

    it('builds the world once the bake is in, at the time last asked for, and counts frames drawn since', async () => {
        const { effect, scene } = await mountReady('level=2');
        const ready = effect.getDiagnostics();
        expect(ready).toMatchObject({
            assets: 'ready',
            settledFrames: 0,
            quality: 'Minimal',
            time: 40,
            level: 2,
            calls: 7,
            triangles: 1234,
        });
        // level=2 is that level's watch, and the clock still turns it on.
        expect(ready.watch.place).toBeCloseTo(1 + 40 / TIMING.watch, 6);
        expect(scene.children.length).toBeGreaterThan(0);
        effect.render();
        effect.render();
        expect(effect.getDiagnostics().settledFrames).toBe(2);
        // A seek is deterministic.
        effect.seek(55);
        const first = effect.getDiagnostics();
        effect.seek(55);
        expect(effect.getDiagnostics()).toEqual(first);
    });

    it('replays an event before the asked frame, the same way every time, and only its own', async () => {
        const { effect } = await mountReady('event=quad&eventAge=1.5');
        const state = effect.getDiagnostics();
        expect(state.counts).toMatchObject({
            clears: 1, lines: 4, quads: 1, locks: 0,
        });
        expect(state.time).toBe(40);
        effect.seek(40);
        expect(effect.getDiagnostics()).toEqual(state);
        // A later seek replays the event again from a clean world, not on top of the first.
        effect.seek(70);
        expect(effect.getDiagnostics().counts).toMatchObject({ clears: 1, lines: 4, quads: 1 });
        expect(effect.getDiagnostics().time).toBe(70);
    });

    it.each([
        ['lock', { locks: 1, hardDrops: 0 }],
        ['drop', { locks: 1, hardDrops: 1 }],
        ['clear', { clears: 1, lines: 2 }],
        ['tspin', { clears: 1, tspins: 1 }],
        ['perfect', { perfects: 1, clears: 0 }],
        ['levelUp', { levelUps: 1 }],
        ['release', { discharges: 1 }],
        ['over', { gameOvers: 1 }],
    ])('fires event=%s at its age', async (event, counts) => {
        const { effect } = await mountReady(`event=${event}&eventAge=0.8`);
        expect(effect.getDiagnostics().counts).toMatchObject(counts);
    });

    it('holds a chain, a back-to-back run and a watch of the night when asked', async () => {
        const { effect } = await mountReady('combo=6&b2b=3&watch=3');
        const state = effect.getDiagnostics();
        expect(state.combo).toBe(6);
        expect(state.b2b).toBe(3);
        expect(state.charge).toBeGreaterThan(0.3);
        expect(state.watch.place).toBe(3);
        expect(state.watch.name).toBe(WATCHES[WALK[3]].name);
    });

    it('plays its live demo loop without a fault, and resets the run each loop', async () => {
        const { effect } = await mountReady('demo=1', 0);
        for (let t = 0; t <= 42; t += 1 / 20) effect.update(t, 1 / 20);
        const state = effect.getDiagnostics();
        expect(state.counts.locks).toBeGreaterThan(10);
        expect(state.counts.quads).toBeGreaterThanOrEqual(1);
        expect(state.counts.tspins).toBeGreaterThanOrEqual(1);
        expect(state.level).toBe(1);
    });

    it('frames the icon through its own lens when asked', async () => {
        const { effect, camera } = await mountReady('icon=1&iconFov=30&iconYaw=-20&iconPitch=12');
        effect.update(41, 1 / 60);
        expect(camera.fov).toBe(30);
        expect(camera.rotation.x).toBeCloseTo((12 * Math.PI) / 180, 9);
        expect(camera.rotation.y).toBeCloseTo((20 * Math.PI) / 180, 9);
    });

    it('reports a bake that could not be made as failed', async () => {
        const held = holdPrepare();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { effect } = mount();
        held.reject(new Error('no land'));
        await settle();
        expect(effect.getDiagnostics().assets).toBe('failed');
        expect(error).toHaveBeenCalled();
        expect(() => effect.render()).not.toThrow();
    });

    it('builds nothing when it is disposed before the bake is in, and restores the camera and renderer', async () => {
        const held = holdPrepare();
        const build = vi.spyOn(PyrestormWorld.prototype, 'build');
        const {
            effect, scene, camera, renderer,
        } = mount();
        camera.fov = 63;
        renderer.toneMapping = THREE.AgXToneMapping; // noPost set it; dispose puts back what was there
        effect.dispose();
        expect(camera.fov).toBe(42);
        expect(camera.near).toBe(0.5);
        expect(camera.far).toBe(25000);
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        held.resolve(prepared);
        await settle();
        expect(build).not.toHaveBeenCalled();
        expect(scene.children).toHaveLength(0);
    });

    it('disposes its world and lets it go from the scene', async () => {
        const { effect, scene } = await mountReady();
        expect(scene.children.length).toBeGreaterThan(0);
        effect.dispose();
        expect(scene.children).toHaveLength(0);
    });
});

describe('Pyrestorm playground controls', () => {
    it('documents in its header every control it reads', () => {
        // By name: as `name=` or named in a control's own line (the icon's lens: iconFov, …).
        const missing = reads.filter((name) => !new RegExp(`\\b${name}\\b`).test(header));
        expect(missing).toEqual([]);
        expect(header).toMatch(/URL params/);
    });

    it('reads the controls the brief and the captures rely on', () => {
        expect(reads).toEqual(expect.arrayContaining([
            'quality', 'level', 'watch', 'event', 'eventAge', 'noPost', 'parts', 'demo', 'board', 'combo', 'icon',
        ]));
    });

    it('is listed in the URL parameter reference with exactly the controls it reads', () => {
        const entries = PLAYGROUND_URL_PARAMETERS.filter((entry) => entry.scope.includes('pyrestorm')
            && entry.sources.includes(FILE));
        expect(entries.map((entry) => entry.name).sort()).toEqual(reads);
    });
});
