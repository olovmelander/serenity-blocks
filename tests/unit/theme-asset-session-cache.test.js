// @ts-check
// Fall and Sunfall keep their parsed asset bundles for the session (the parse was an 83-132 ms
// main-thread task on every start). The default load parses once; a stale load does not dispose
// the cache; disposing a theme's assets releases GPU copies only, so the next start reuses them.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FALL_DIR = new URL('../../src/themes/fall/assets/', import.meta.url);
const SUNFALL_DIR = new URL('../../src/themes/sunfall/assets/', import.meta.url);

function diskGlb(dir) {
    const parse = GLTFLoader.prototype.parseAsync;
    return vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async function load(url) {
        const name = String(url).split('/').pop().split('?')[0];
        const bytes = readFileSync(new URL(name, dir));
        return parse.call(this, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    });
}

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

describe('Fall session asset cache', () => {
    it('parses once per session and survives a stale load and a dispose', async () => {
        const gltf = diskGlb(FALL_DIR);
        vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new THREE.DataTexture(new Uint8Array(16), 2, 2));
        const { loadFallAssets, disposeFallAssets } = await import('../../src/themes/fall/fall-assets.js');
        const first = await loadFallAssets();
        const fetched = gltf.mock.calls.length;
        expect(fetched).toBeGreaterThan(0);
        const stale = await loadFallAssets({ isCurrent: () => false });
        expect(stale).toBeNull();
        disposeFallAssets(first);
        const again = await loadFallAssets();
        expect(again).toBe(first);
        expect(gltf.mock.calls.length).toBe(fetched);
        const bark = Object.values(again.trees)[0].bark;
        expect(bark.attributes.position.array.length).toBeGreaterThan(0);
    });

    it('never caches a load with injected loaders (tests, tools)', async () => {
        const gltf = diskGlb(FALL_DIR);
        const { loadFallAssets } = await import('../../src/themes/fall/fall-assets.js');
        const loader = new GLTFLoader();
        const textureLoader = { loadAsync: async () => new THREE.DataTexture(new Uint8Array(16), 2, 2) };
        const a = await loadFallAssets({ loader, textureLoader });
        const b = await loadFallAssets({ loader, textureLoader });
        expect(b).not.toBe(a);
        expect(gltf.mock.calls.length).toBeGreaterThan(0);
    });
});

describe('Sunfall session asset cache', () => {
    it('parses once per session and survives a stale load and a dispose', async () => {
        const gltf = diskGlb(SUNFALL_DIR);
        const { loadSunfallAssets, disposeSunfallAssets } = await import('../../src/themes/sunfall/sunfall-assets.js');
        const first = await loadSunfallAssets();
        expect(gltf.mock.calls.length).toBe(3);
        expect(await loadSunfallAssets({ isCurrent: () => false })).toBeNull();
        disposeSunfallAssets(first);
        const again = await loadSunfallAssets();
        expect(again).toBe(first);
        expect(gltf.mock.calls.length).toBe(3);
        expect(again.shell[0].attributes.position.array.length).toBeGreaterThan(0);
    });

    it('drops a failed load so the next start tries again', async () => {
        const spy = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValueOnce(new Error('offline'));
        const { loadSunfallAssets } = await import('../../src/themes/sunfall/sunfall-assets.js');
        await expect(loadSunfallAssets()).rejects.toThrow('offline');
        spy.mockRestore();
        diskGlb(SUNFALL_DIR);
        const assets = await loadSunfallAssets();
        expect(assets.shell.length).toBeGreaterThan(0);
    });
});
