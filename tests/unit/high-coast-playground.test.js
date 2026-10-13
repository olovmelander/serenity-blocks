/**
 * High Coast — the playground effect: the same world and post the theme ships, mounted alone.
 *
 * `create()` is synchronous and hands back the playground contract at once; the baked coast loads
 * asynchronously behind it (`getDiagnostics().assets` is 'loading' until the world is in, then
 * 'ready', or 'failed'). The load is replaced here by one the test releases, fed from the real
 * baked PNGs, so nothing waits on the network.
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
// (Aliased: a binding named `meta` trips vitest's import rewrite next to import.meta.)
import { create, meta as effectMeta } from '../../src/playground/effects/high-coast.effect.js';
import { HighCoastWorld } from '../../src/themes/high-coast/high-coast-world.js';
import { FIELDS, FIELD_ORDER, TIMING } from '../../src/themes/high-coast/high-coast-core.js';
import { decodeField } from '../../src/themes/high-coast/high-coast-field.js';
import { decodePng } from '../../scripts/high-coast/png.mjs';
import { PLAYGROUND_URL_PARAMETERS } from '../../src/ui/url-parameters/playground-parameters.js';

const FILE = 'src/playground/effects/high-coast.effect.js';
const SCOPE = 'playground.html — high-coast';
const source = readFileSync(new URL('../../src/playground/effects/high-coast.effect.js', import.meta.url), 'utf8');
const header = source.slice(source.indexOf('/**'), source.indexOf('*/', source.indexOf('/**')));
/** Every URL parameter the effect reads, by the name it reads it under. */
const reads = [...new Set([
    ...[...source.matchAll(/\bparams\.(?:get|has)\(\s*'([^']+)'\s*\)/g)].map((match) => match[1]),
    ...[...source.matchAll(/\bnum\(\s*params\s*,\s*'([^']+)'/g)].map((match) => match[1]),
])].sort();

vi.setConfig({ testTimeout: 20_000 });

let prepared;

beforeAll(() => {
    const fields = {};
    for (const name of FIELD_ORDER) {
        const file = new URL(`../../src/themes/high-coast/assets/coast-${name}.png`, import.meta.url);
        const { rgba } = decodePng(readFileSync(file));
        fields[name] = { ...decodeField(rgba, FIELDS[name]), size: FIELDS[name].size, source: 'asset' };
    }
    fields.source = 'asset';
    prepared = HighCoastWorld.prepareSync('Minimal', fields);
});

const effects = [];

afterEach(() => {
    effects.splice(0).forEach((effect) => effect.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** A coast load the test releases (or fails) when it chooses. */
function holdPrepare() {
    const held = {};
    held.promise = new Promise((resolve, reject) => {
        held.resolve = resolve;
        held.reject = reject;
    });
    held.spy = vi.spyOn(HighCoastWorld, 'prepare').mockImplementation(() => held.promise);
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
        setRenderTarget: vi.fn(),
        getRenderTarget: vi.fn(() => null),
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

describe('High Coast playground effect', () => {
    it('names itself as the full world', () => {
        expect(effectMeta.id).toBe('high-coast');
        expect(effectMeta.title).toMatch(/High Coast/);
        expect(typeof effectMeta.description).toBe('string');
        expect(effectMeta.description.length).toBeGreaterThan(10);
        expect(create).toBeTypeOf('function');
    });

    it('mounts the theme\'s own world and post, and nothing from outside the theme', () => {
        const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
        const theme = '../../themes/high-coast/';
        const outside = imports.filter((from) => from !== 'three/webgpu' && !from.startsWith(theme));
        expect(outside).toEqual([]);
        for (const module of ['world', 'post', 'composition']) {
            expect(source).toContain(`../../themes/high-coast/high-coast-${module}.js`);
        }
        expect(source.match(/new HighCoastWorld\(/g)).toHaveLength(1);
        expect(source).toMatch(/new HighCoastWorld\(\{[^}]*capture: true/);
        expect(source).toContain('HighCoastWorld.prepare(');
        expect(source).toContain('world.prerender(renderer)');
    });

    it('hands back the playground contract at once, and reports the coast as loading', () => {
        const held = holdPrepare();
        const { effect, renderer, scene } = mount();
        expect(held.spy).toHaveBeenCalledOnce();
        expect(held.spy.mock.calls[0][0]).toBe('Minimal');
        for (const method of ['update', 'seek', 'render', 'resize', 'getDiagnostics', 'dispose', 'camera']) {
            expect(effect[method], method).toBeTypeOf('function');
        }
        expect(effect.getDiagnostics()).toMatchObject({ assets: 'loading', settledFrames: 0, backend: 'WebGL2' });
        // Until the coast is in, frames go on without a world: the bare scene is drawn.
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

    it('builds the world once the coast is in, at the time last asked for, and counts frames drawn since', async () => {
        const held = holdPrepare();
        const { effect, renderer, scene } = mount('level=2');
        effect.seek(40);
        held.resolve(prepared);
        await settle();
        const ready = effect.getDiagnostics();
        expect(ready).toMatchObject({
            assets: 'ready',
            settledFrames: 0,
            quality: 'Minimal',
            source: 'asset',
            time: 40,
            level: 2,
            calls: 7,
            triangles: 1234,
        });
        // level=2 is that level's hour, and the clock still turns it on.
        expect(ready.hour.place).toBeCloseTo(1 + 40 / TIMING.hour, 6);
        expect(scene.children.length).toBeGreaterThan(0);
        effect.render();
        effect.render();
        expect(effect.getDiagnostics().settledFrames).toBe(2);
        // The land's shadow passes are painted before the frame, on the effect's renderer.
        expect(renderer.setRenderTarget).toHaveBeenCalled();
        expect(renderer.render).toHaveBeenCalled();
        // A seek is deterministic.
        effect.seek(55);
        const first = effect.getDiagnostics();
        effect.seek(55);
        expect(effect.getDiagnostics()).toEqual(first);
    });

    it('holds the light at an asked hour, whatever the clock', async () => {
        const held = holdPrepare();
        const { effect } = mount('hour=2.5');
        effect.seek(10);
        held.resolve(prepared);
        await settle();
        expect(effect.getDiagnostics().hour.place).toBe(2.5);
        effect.seek(70);
        expect(effect.getDiagnostics().hour).toMatchObject({ place: 2.5, from: 2, to: 3 });
    });

    it('replays an event before the asked frame, the same way every time', async () => {
        const held = holdPrepare();
        const { effect } = mount('event=quad&eventAge=1.5');
        effect.seek(40);
        held.resolve(prepared);
        await settle();
        const state = effect.getDiagnostics();
        expect(state.counts).toMatchObject({ clears: 1, lines: 4, quads: 1 });
        expect(state.time).toBe(40);
        // The land has risen: the sea stands below rest.
        expect(state.sea).toBeLessThan(0);
        effect.seek(40);
        expect(effect.getDiagnostics()).toEqual(state);
    });

    it('replays only its own event when seeked to a later time', async () => {
        const held = holdPrepare();
        const { effect } = mount('event=quad&eventAge=1.5');
        effect.seek(40);
        held.resolve(prepared);
        await settle();
        effect.seek(70);
        const state = effect.getDiagnostics();
        expect(state.counts).toMatchObject({ clears: 1, lines: 4, quads: 1 });
        expect(state.time).toBe(70);
    });

    it('holds a chain, a back-to-back run and a lift when asked', async () => {
        const held = holdPrepare();
        const { effect } = mount('combo=4&b2b=3&lift=12');
        effect.seek(30);
        held.resolve(prepared);
        await settle();
        const state = effect.getDiagnostics();
        expect(state).toMatchObject({ combo: 4, b2b: 3, time: 30 });
        expect(state.counts.clears).toBe(4);
        expect(state.beacon).toBeGreaterThan(0.5);
        expect(state.sea).toBeLessThan(-5);
    });

    it('reports a coast that could not be loaded as failed', async () => {
        const held = holdPrepare();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { effect } = mount();
        held.reject(new Error('no coast'));
        await settle();
        expect(effect.getDiagnostics().assets).toBe('failed');
        expect(error).toHaveBeenCalled();
        expect(() => effect.render()).not.toThrow();
    });

    it('builds nothing when it is disposed before the coast is in, and restores the camera and renderer', async () => {
        const held = holdPrepare();
        const build = vi.spyOn(HighCoastWorld.prototype, 'build');
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
        const held = holdPrepare();
        const { effect, scene } = mount();
        held.resolve(prepared);
        await settle();
        expect(scene.children.length).toBeGreaterThan(0);
        effect.dispose();
        expect(scene.children).toHaveLength(0);
    });
});

describe('High Coast playground controls', () => {
    it('documents in its header every control it reads', () => {
        const missing = reads.filter((name) => !header.includes(`${name}=`));
        expect(missing).toEqual([]);
    });

    it('is listed in the URL parameter reference with exactly the controls it reads', () => {
        const entries = PLAYGROUND_URL_PARAMETERS
            .filter((entry) => entry.scope === SCOPE && entry.sources.includes(FILE));
        expect(entries.map((entry) => entry.name).sort()).toEqual(reads);
        // Nothing else claims the scope.
        expect(PLAYGROUND_URL_PARAMETERS.filter((entry) => entry.scope === SCOPE)).toHaveLength(entries.length);
        entries.forEach((entry) => {
            expect(entry.example, entry.name).toMatch(new RegExp(`^${entry.name}=`));
            expect(entry.description.length, entry.name).toBeGreaterThan(10);
        });
    });

    it('reads the controls the brief and the captures rely on', () => {
        expect(reads).toEqual(expect.arrayContaining([
            'quality', 'level', 'hour', 'event', 'eventAge', 'noPost', 'parts', 'demo', 'combo', 'lift', 'b2b',
        ]));
    });
});
