import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    loadBitmapTexture, loadDecodedTexture, loadTextureDecoded, uploadTextureNow,
} from '../../src/themes/shared/decoded-texture.js';

/**
 * Images decoded off the main thread (src/themes/shared/decoded-texture.js): three's upload of an
 * HTMLImageElement decodes the file on the main thread (Lunara's moon map ~15 ms, Verdant Hills' maps
 * ~25 ms of a first-visit switch, 2026-10-31). The bitmap is decoded as the upload wants it
 * (unpremultiplied, flipped at decode when the texture flips) and the texture reads the same texels.
 */
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

function stubDecoder({ fail = false } = {}) {
    const calls = [];
    const bitmap = { width: 4, height: 2, close: vi.fn() };
    vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, url, blob: async () => ({ url }) })));
    vi.stubGlobal('createImageBitmap', vi.fn(async (blob, options) => {
        calls.push(options);
        if (fail) throw new Error('decode failed');
        return bitmap;
    }));
    return { calls, bitmap };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('loadBitmapTexture', () => {
    it('decodes unpremultiplied, flips at decode when the texture flips, and hands over flipY false', async () => {
        const { calls, bitmap } = stubDecoder();
        const flipped = await loadBitmapTexture('a.png');
        expect(calls[0]).toEqual({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
        expect(flipped.image).toBe(bitmap);
        expect(flipped.flipY).toBe(false);
        const straight = await loadBitmapTexture('b.png', { flipY: false });
        expect(calls[1].imageOrientation).toBe('from-image');
        expect(straight.flipY).toBe(false);
        straight.dispose();
        expect(bitmap.close).toHaveBeenCalled();
    });

    it('is null where there is no createImageBitmap', async () => {
        vi.stubGlobal('createImageBitmap', undefined);
        await expect(loadBitmapTexture('a.png')).resolves.toBeNull();
    });
});

describe('loadDecodedTexture', () => {
    it('falls back to the given loader without a decoder or when the decode fails', async () => {
        const loader = { loadAsync: vi.fn(async (url) => ({ url, viaLoader: true })) };
        vi.stubGlobal('createImageBitmap', undefined);
        await expect(loadDecodedTexture('x.png', loader)).resolves.toEqual({ url: 'x.png', viaLoader: true });
        stubDecoder({ fail: true });
        await expect(loadDecodedTexture('y.png', loader)).resolves.toEqual({ url: 'y.png', viaLoader: true });
        stubDecoder();
        const decoded = await loadDecodedTexture('z.png', loader, { flipY: false });
        expect(decoded.isTexture).toBe(true);
        expect(loader.loadAsync).toHaveBeenCalledTimes(2);
    });
});

describe('loadTextureDecoded', () => {
    it('returns the texture at once and fills it when the bitmap lands', async () => {
        const { bitmap } = stubDecoder();
        const texture = loadTextureDecoded('moon.jpg');
        expect(texture.isTexture).toBe(true);
        const before = texture.version;
        await flush();
        expect(texture.image).toBe(bitmap);
        expect(texture.flipY).toBe(false);
        expect(texture.version).toBeGreaterThan(before);
    });

    it('lets the bitmap go when the texture is disposed first, and fills it the old way without a decoder', async () => {
        const { bitmap } = stubDecoder();
        const early = loadTextureDecoded('moon.jpg');
        early.dispose();
        await flush();
        expect(early.image).not.toBe(bitmap);
        expect(bitmap.close).toHaveBeenCalled();

        vi.stubGlobal('createImageBitmap', undefined);
        const image = { width: 2, height: 2 };
        const load = vi.spyOn(THREE.ImageLoader.prototype, 'load').mockImplementation((url, onLoad) => onLoad(image));
        const old = loadTextureDecoded('nebula.png');
        await flush();
        expect(load).toHaveBeenCalledWith('nebula.png', expect.any(Function));
        expect(old.image).toBe(image);
        expect(old.flipY).toBe(true); // three flips it at upload, as before
    });
});

describe('uploads in the task the image lands in', () => {
    it('calls onImage once the image is in, on either path', async () => {
        const { bitmap } = stubDecoder();
        const seen = [];
        const texture = loadTextureDecoded('moon.jpg', { onImage: (t) => seen.push(t.image) });
        expect(seen).toEqual([]);
        await flush();
        expect(seen).toEqual([bitmap]);
        expect(texture.image).toBe(bitmap);

        vi.stubGlobal('createImageBitmap', undefined);
        const image = { width: 2, height: 2 };
        vi.spyOn(THREE.ImageLoader.prototype, 'load').mockImplementation((url, onLoad) => onLoad(image));
        const old = [];
        loadTextureDecoded('nebula.png', { onImage: (t) => old.push(t.image) });
        await flush();
        expect(old).toEqual([image]);
    });

    it('uploadTextureNow hands the texture to initTexture, and shrugs off a renderer that cannot', () => {
        const texture = new THREE.Texture();
        const renderer = { initTexture: vi.fn() };
        uploadTextureNow(renderer, texture);
        expect(renderer.initTexture).toHaveBeenCalledWith(texture);
        expect(() => uploadTextureNow({ initTexture: () => { throw new Error('not initialised'); } }, texture)).not.toThrow();
        expect(() => uploadTextureNow(null, texture)).not.toThrow();
    });
});
