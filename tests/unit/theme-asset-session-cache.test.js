// @ts-check
// Fall and Sunfall keep their parsed asset bundles for the session (the parse was an 83-132 ms
// main-thread task on every start). The default load parses once; a stale load does not dispose
// the cache; each start gets geometry objects of its own over the kept arrays (shared/fresh-geometry.js),
// so one start's dispose() never reaches the next one's buffers (three r186 cannot re-upload a disposed
// interleaved attribute).
import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
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

/** b is a geometry of its own (attributes and interleaved buffers too) over a's arrays. */
function expectFreshOverSameArrays(a, b) {
    expect(b).not.toBe(a);
    const names = Object.keys(a.attributes);
    expect(Object.keys(b.attributes)).toEqual(names);
    for (const name of names) {
        const [x, y] = [a.attributes[name], b.attributes[name]];
        expect(y).not.toBe(x);
        expect(y.array).toBe(x.array);
        expect([y.itemSize, y.normalized, y.count]).toEqual([x.itemSize, x.normalized, x.count]);
        if (x.isInterleavedBufferAttribute) {
            expect(y.isInterleavedBufferAttribute).toBe(true);
            expect(y.data).not.toBe(x.data);
            expect([y.offset, y.data.stride]).toEqual([x.offset, x.data.stride]);
        }
    }
    if (a.index) {
        expect(b.index).not.toBe(a.index);
        expect(b.index.array).toBe(a.index.array);
    }
    expect(b.groups).toEqual(a.groups);
    expect(b.drawRange).toEqual(a.drawRange);
}

// Real GLBs are parsed here: slow when the whole suite runs at once.
describe('Fall session asset cache', { timeout: 60_000 }, () => {
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
        expect(gltf.mock.calls.length).toBe(fetched);
        expect(again).not.toBe(first);
        const [a, b] = [first, again].map((x) => Object.values(x.trees)[0].bark);
        expectFreshOverSameArrays(a, b);
        const meshes = Object.keys(first.foliage.meshes);
        expect(meshes.length).toBeGreaterThan(0);
        for (const k of meshes) expectFreshOverSameArrays(first.foliage.meshes[k], again.foliage.meshes[k]);
        const geometries = (x) => { const out = []; x.squirrel.scene.traverse((o) => { if (o.geometry) out.push(o.geometry); }); return out; };
        const [sa, sb] = [first, again].map(geometries);
        expect(sb.length).toBe(sa.length);
        sa.forEach((g, i) => expectFreshOverSameArrays(g, sb[i]));
        expect(again.impostors.texture).toBe(first.impostors.texture);
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

describe('Sunfall session asset cache', { timeout: 60_000 }, () => {
    it('parses once per session and survives a stale load and a dispose', async () => {
        const gltf = diskGlb(SUNFALL_DIR);
        const { loadSunfallAssets, disposeSunfallAssets } = await import('../../src/themes/sunfall/sunfall-assets.js');
        const first = await loadSunfallAssets();
        expect(gltf.mock.calls.length).toBe(3);
        expect(await loadSunfallAssets({ isCurrent: () => false })).toBeNull();
        disposeSunfallAssets(first);
        const again = await loadSunfallAssets();
        expect(gltf.mock.calls.length).toBe(3);
        for (const part of ['shell', 'ledge', 'crowns']) {
            expect(again[part].length).toBe(first[part].length);
            first[part].forEach((g, i) => expectFreshOverSameArrays(g, again[part][i]));
        }
        expect(again.plan).toBe(first.plan);
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
