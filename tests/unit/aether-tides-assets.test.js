import { readFile } from 'node:fs/promises';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { AetherTidesWorld } from '../../src/themes/aether-tides/aether-tides-world.js';
import { stubRenderer } from './helpers/tsl-node-build.js';

// Vite serves public/ beside the HTML entry, including under a deployment subdirectory.
// Electron loads the same relative path beside dist/index.html inside app.asar.
const publicRoot = new URL('../../public/', import.meta.url);
let world;

function buildWorld(quality, live) {
    const renderer = { initTexture: vi.fn() };
    world = new AetherTidesWorld({
        scene: new THREE.Scene(), renderer, quality, live,
    }).build();
    return renderer;
}

function serveAssets() {
    const fetchAsset = vi.fn(async (url) => new Response(await readFile(new URL(url, publicRoot))));
    vi.stubGlobal('fetch', fetchAsset);
    return fetchAsset;
}

// Keep the actual compiled bindings alive while the asynchronous decode replaces the
// placeholder. Rebuilding the material after decode would hide a merged binding.
function fragmentBindings(mesh) {
    const builder = new THREE.WGSLNodeBuilder(mesh, stubRenderer());
    builder.scene = world.scene;
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = mesh.material;
    builder.material = mesh.material;
    builder.build();
    return builder.uniforms.fragment;
}

afterEach(() => {
    world?.dispose();
    world = null;
    vi.unstubAllGlobals();
});

describe('Aether Tides cloud texture lifecycle', () => {
    it('compiles filtered shadow reads before the low-resolution light buffer is primed', () => {
        buildWorld('High', true);
        const builder = new THREE.WGSLNodeBuilder(world.nebula.mesh, stubRenderer());
        const { light } = world;
        expect(light.tShade.value).toBe(light.blank);
        // A nearest-only placeholder emits textureLoad into the shader. Later replacing the
        // binding with a linear light buffer cannot change that instruction.
        for (const texture of [light.blank, light.dark, light.shadeRead.texture, light.glow.texture]) {
            expect(builder.isUnfilterable(texture)).toBe(false);
        }
    });

    it.each([
        ['High', true, 'ionisation-front.webp'],
        ['Low', true, 'ionisation-front-small.webp'],
        ['Minimal', false, 'ionisation-front-small.webp'],
    ])('binds the %s asset in the picture and active simulation passes (fluid %s)', async (quality, live, filename) => {
        const renderer = buildWorld(quality, live);
        const request = serveAssets();
        const bitmap = { width: 4, height: 4, close: vi.fn() };
        const decode = vi.fn(async () => bitmap);
        vi.stubGlobal('createImageBitmap', decode);
        const passes = [world.nebula.mesh];
        if (live) {
            passes.push(new THREE.QuadMesh(world.fluid.restMaterial), new THREE.QuadMesh(world.fluid.dyeMaterial));
        }
        const uniforms = passes.map(fragmentBindings);
        expect(world.fieldUniforms.plateMix.value).toBe(0);
        await expect(world.loadTextures()).resolves.toBe(true);
        const texture = world.cloudTexture;
        expect(request).toHaveBeenCalledWith(`./textures/aether-tides/${filename}`);
        const bytes = Buffer.from(await decode.mock.calls[0][0].arrayBuffer());
        expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
        expect(texture.image).toBe(bitmap);
        expect(texture.flipY).toBe(false);
        expect(renderer.initTexture).toHaveBeenCalledExactlyOnceWith(texture);
        expect(world.fieldUniforms.plateMix.value).toBe(1);
        for (const bindings of uniforms) {
            const textures = bindings.filter((uniform) => uniform.value?.isTexture).map((uniform) => uniform.value);
            expect(textures).toContain(texture);
            expect(textures).toContain(world.noise);
        }
        expect(bitmap.close).not.toHaveBeenCalled();
        world.dispose();
        expect(bitmap.close).toHaveBeenCalledTimes(1);
    });

    it('closes a late bitmap without uploading it to a retired world', async () => {
        const renderer = buildWorld('High', true);
        serveAssets();
        const started = Promise.withResolvers();
        const pending = Promise.withResolvers();
        vi.stubGlobal('createImageBitmap', () => {
            started.resolve();
            return pending.promise;
        });
        const loading = world.loadTextures();
        await started.promise;
        world.dispose();
        const bitmap = { width: 4, height: 4, close: vi.fn() };
        pending.resolve(bitmap);
        await expect(loading).resolves.toBe(false);
        expect(bitmap.close).toHaveBeenCalledTimes(1);
        expect(renderer.initTexture).not.toHaveBeenCalled();
        expect(world.cloudTexture).toBeNull();
    });

    it('keeps the procedural field when the asset cannot be decoded', async () => {
        const renderer = buildWorld('Minimal', false);
        serveAssets();
        vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));
        await expect(world.loadTextures()).resolves.toBe(false);
        expect(renderer.initTexture).not.toHaveBeenCalled();
        expect(world.cloudSampler.value).toBe(world.noise);
        expect(world.fieldUniforms.plateMix.value).toBe(0);
    });
});
