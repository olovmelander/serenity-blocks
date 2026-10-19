/**
 * Spring — the woods' impostor atlas is kept only when every tree was drawn into it.
 *
 * The atlas is drawn once and kept for the session. Its warm compileAsync took the depth from the
 * theme's renderer (which has none) instead of the atlas's target, so the bake needed other
 * pipelines; under the app's async pipelines (a start under a loading surface, a hidden prewarm,
 * an in-play switch) those were left for later and every draw of the bake was skipped: an empty
 * atlas, kept, and no far woods until the theme was started again (SwiftShader, 2026-10-19: 0 of
 * 16 draws). The warm now compiles for the target's depth, the targets are one-shot bakes the
 * async pipelines and build budget leave alone, and the bake counts its draws and draws again on
 * later frames until it is whole.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
    afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { isOneShotRenderTarget } from '../../src/rendering/async-render-pipelines.js';
import { SPRING_TREE_URLS, parseSpringMeshes, parseSpringTree } from '../../src/themes/spring/spring-assets.js';
import { BAKE_ATTEMPTS, ImpostorAtlas } from '../../src/themes/spring/spring-impostors.js';
import { createLatticeTexture, createNoiseTexture, createUniforms } from '../../src/themes/spring/spring-tsl.js';
import {
    REST_RIG, SpringWorld, fovForAspect, useValleyGround, valleyGround,
} from '../../src/themes/spring/spring-world.js';
import { decodeValley } from '../../src/themes/spring/spring-terrain.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(here, '../../src/themes/spring/assets');

/** The asset pack as loadSpringAssets builds it, read from the shipped files. */
let assets = null;

async function parse(file) {
    const bytes = fs.readFileSync(path.join(ASSETS, file));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new Promise((resolve, reject) => {
        new GLTFLoader().parse(buffer, '', resolve, reject);
    });
}

beforeAll(async () => {
    const valley = fs.readFileSync(path.join(ASSETS, 'spring-valley.bin'));
    useValleyGround(decodeValley(new Uint8Array(zlib.inflateSync(valley))));
    assets = {
        foliage: parseSpringMeshes(await parse('spring-foliage.glb'), 'Foliage'),
        rocks: parseSpringMeshes(await parse('spring-rocks.glb'), 'Rocks'),
        trees: {},
    };
    for (const name of Object.keys(SPRING_TREE_URLS)) {
        // eslint-disable-next-line no-await-in-loop
        assets.trees[name] = parseSpringTree(await parse(`${name}.glb`), name);
    }
});

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * A renderer that draws what it is given, less `skip` draws a render while `skips` lasts (as a
 * draw left for later is), counting its draws as three's do. `counts: false`: it counts nothing.
 */
function fakeRenderer({ skips = [], counts = true } = {}) {
    let target = null;
    const renders = [];
    const renderer = {
        info: counts ? { render: { drawCalls: 0 } } : undefined,
        renders,
        getRenderTarget: () => target,
        setRenderTarget: (rt) => { target = rt; },
        getClearColor: (colour) => colour.set(0x8ea6c4),
        getClearAlpha: () => 1,
        setClearColor() {},
        clear() {},
        render(scene) {
            let meshes = 0;
            scene.traverse((object) => {
                if (object.isMesh && object.visible && (object.count ?? 1) > 0) meshes += 1;
            });
            const skip = skips.length ? skips.shift() : 0;
            renders.push({ target, drawn: meshes - skip });
            if (counts) renderer.info.render.drawCalls += meshes - skip;
        },
    };
    return renderer;
}

const makeAtlas = () => new ImpostorAtlas(createUniforms(), {
    noise: createNoiseTexture(), lattice: createLatticeTexture(),
}, assets, { cellPixels: 16 });

describe('spring woods: the impostor atlas bake', () => {
    it('is a one-shot bake the app\'s async pipelines and build budget leave alone', () => {
        const atlas = makeAtlas();
        expect(atlas.drawsPerPass).toBeGreaterThan(8); // the bark and the sprays of eight models
        expect(isOneShotRenderTarget(atlas.albedoTarget)).toBe(true);
        expect(isOneShotRenderTarget(atlas.normalTarget)).toBe(true);
        atlas.dispose();
    });

    it('warms the pipelines the bake draws with: the atlas\'s depth, on a renderer without one', async () => {
        const atlas = makeAtlas();
        const renderer = fakeRenderer();
        renderer.depth = false; // the theme's renderer: the scene pass owns depth
        renderer.stencil = false;
        const warmed = [];
        renderer.compileAsync = () => {
            warmed.push({ target: renderer.getRenderTarget(), depth: renderer.depth, stencil: renderer.stencil });
            return Promise.resolve();
        };
        await atlas.bake(renderer);
        expect(warmed).toEqual([{ target: atlas.albedoTarget, depth: true, stencil: false }]);
        // The renderer's own are given back, and the bake is drawn whole after the warm.
        expect([renderer.depth, renderer.stencil, renderer.getRenderTarget()]).toEqual([false, false, null]);
        expect(atlas.ready).toBe(true);
        atlas.dispose();
    });

    it('gives the renderer its depth back when the warm throws as it starts', async () => {
        const atlas = makeAtlas();
        const renderer = fakeRenderer();
        renderer.depth = false;
        renderer.stencil = false;
        renderer.compileAsync = () => { throw new Error('lost'); };
        await expect(atlas.bake(renderer)).rejects.toThrow('lost');
        expect([renderer.depth, renderer.stencil, renderer.getRenderTarget()]).toEqual([false, false, null]);
        expect(atlas.ready).toBe(false);
        atlas.dispose();
    });

    it('is kept at once when every tree is drawn, and lets the bake\'s trees go', () => {
        const atlas = makeAtlas();
        const renderer = fakeRenderer();
        expect(atlas.draw(renderer)).toBe(true);
        expect(atlas.ready).toBe(true);
        expect(atlas.attempts).toBe(1);
        expect(atlas.forest).toBeNull();
        // Both passes, into their own targets, and the renderer's target is given back.
        expect(renderer.renders.map((r) => r.target)).toEqual([atlas.albedoTarget, atlas.normalTarget]);
        expect(renderer.getRenderTarget()).toBeNull();
        atlas.dispose();
    });

    it('draws again on the next frames while a tree was left out, and is kept once whole', () => {
        const atlas = makeAtlas();
        // First frame: most of the albedo pass's builds left for later (an in-play switch's budget).
        // Second frame: the normals pass misses one. Third: whole.
        const renderer = fakeRenderer({ skips: [atlas.drawsPerPass - 2, 0, 0, 1] });
        expect(atlas.draw(renderer)).toBe(false);
        expect(atlas.ready).toBe(false);
        expect(atlas.forest).not.toBeNull(); // the bake's trees stay for the next try
        expect(atlas.draw(renderer)).toBe(false);
        expect(atlas.draw(renderer)).toBe(true);
        expect(atlas.ready).toBe(true);
        expect(atlas.attempts).toBe(3);
        expect(renderer.renders.slice(-2).every((r) => r.drawn === atlas.drawsPerPass)).toBe(true);
        atlas.dispose();
    });

    it('keeps what it has, with a warning, after BAKE_ATTEMPTS bakes that were never whole', () => {
        const atlas = makeAtlas();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const renderer = fakeRenderer({ skips: Array(2 * BAKE_ATTEMPTS).fill(1) });
        for (let i = 1; i < BAKE_ATTEMPTS; i += 1) expect(atlas.draw(renderer)).toBe(false);
        expect(warn).not.toHaveBeenCalled();
        expect(atlas.draw(renderer)).toBe(true);
        expect(atlas.ready).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
        atlas.dispose();
    });

    it('takes a bake as whole on a renderer that counts no draws', () => {
        const atlas = makeAtlas();
        expect(atlas.draw(fakeRenderer({ counts: false, skips: [3, 3] }))).toBe(true);
        atlas.dispose();
    });
});

describe('spring woods: the world shows its cards once the atlas is whole', () => {
    it('keeps the cards hidden while the bake is drawn again, then shows every one', () => {
        const scene = new THREE.Scene();
        const aspect = 16 / 9;
        const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
        const world = new SpringWorld({
            scene, quality: 'Minimal', capture: true, prepared: { quality: 'Minimal', ground: valleyGround(), assets },
        }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, aspect);
        const cards = world.parts.woods.mesh;
        const sites = world.parts.woods.sites.length;
        expect(sites).toBeGreaterThan(1000);
        const step = (t) => {
            world.updateCamera(camera, { time: t, delta: 1 / 30 });
            world.update({ time: t, delta: 1 / 30 }, camera);
        };
        // The theme's first frames under a switch's budget: the bake is short of trees twice.
        const renderer = fakeRenderer({ skips: [5, 5, 0, 2] });
        world.prerender(renderer);
        step(0.1);
        expect(cards.geometry.instanceCount).toBe(0);
        expect(world.getState().woods).toEqual({ baked: false, failed: false, attempts: 1 });
        world.prerender(renderer);
        step(0.2);
        expect(cards.geometry.instanceCount).toBe(0);
        world.prerender(renderer);
        step(0.3);
        expect(world.getState().woods).toEqual({ baked: true, failed: false, attempts: 3 });
        expect(cards.geometry.instanceCount).toBe(sites);
        // Kept: no more bakes.
        const renders = renderer.renders.length;
        world.prerender(renderer);
        expect(renderer.renders.length).toBe(renders);
        world.dispose();
    });

    it('draws the atlas on the next frame when the bake before the first one did not finish', async () => {
        const scene = new THREE.Scene();
        const world = new SpringWorld({
            scene, quality: 'Minimal', capture: true, prepared: { quality: 'Minimal', ground: valleyGround(), assets },
        }).build();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        // The compile is refused while the app is busy: the woods are not given up on.
        const renderer = fakeRenderer();
        renderer.compileAsync = () => Promise.reject(new Error('busy'));
        await world.bakeImpostors(renderer);
        expect(world.getState().woods).toEqual({ baked: false, failed: false, attempts: 0 });
        world.prerender(renderer);
        expect(world.getState().woods).toEqual({ baked: true, failed: false, attempts: 1 });
        world.dispose();
    });
});
