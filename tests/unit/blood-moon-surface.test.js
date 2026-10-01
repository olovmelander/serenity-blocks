import { createHash } from 'node:crypto';
import {
    afterAll, afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { createLunarSurface } from '../../src/playground/effects/blood-moon-surface.js';

const SIZE = 512;
const fingerprint = (surface) => createHash('sha256')
    .update(surface.texture.image.data)
    .update(surface.normalTexture.image.data)
    .digest('hex');

describe('Blood Moon baked lunar surface', () => {
    let surface;

    beforeAll(() => { surface = createLunarSurface(THREE, SIZE); });
    afterAll(() => { surface.dispose(); });

    it('reproduces the same bytes for cached calls and a fresh deterministic bake', async () => {
        const cached = createLunarSurface(THREE, SIZE);
        // A new module owns an empty bake cache, so this also exercises the seed
        // instead of merely comparing two views of one cached typed array.
        vi.resetModules();
        const { createLunarSurface: createFreshSurface } = await import(
            '../../src/playground/effects/blood-moon-surface.js'
        );
        const fresh = createFreshSurface(THREE, SIZE);
        try {
            expect(fingerprint(cached)).toBe(fingerprint(surface));
            expect(fingerprint(fresh)).toBe(fingerprint(surface));
            expect(fresh.texture.image.data).not.toBe(surface.texture.image.data);
        } finally {
            cached.dispose();
            fresh.dispose();
        }
    });

    it('provides linear equirectangular textures with a repeating longitude and clamped poles', () => {
        for (const map of [surface.texture, surface.normalTexture]) {
            expect(map).toBeInstanceOf(THREE.DataTexture);
            expect(map.image.width).toBe(SIZE);
            expect(map.image.height).toBe(SIZE / 2);
            expect(map.image.data).toBeInstanceOf(Uint8Array);
            expect(map.image.data.length).toBe(SIZE * (SIZE / 2) * 4);
            expect(map.format).toBe(THREE.RGBAFormat);
            expect(map.type).toBe(THREE.UnsignedByteType);
            expect(map.colorSpace).toBe(THREE.NoColorSpace);
            expect(map.wrapS).toBe(THREE.RepeatWrapping);
            expect(map.wrapT).toBe(THREE.ClampToEdgeWrapping);
            expect(map.flipY).toBe(false);
            expect(map.magFilter).toBe(THREE.LinearFilter);
            expect(map.minFilter).toBe(THREE.LinearMipmapLinearFilter);
            expect(map.generateMipmaps).toBe(true);
        }
    });

    it('bakes opaque grayscale albedo with usable tonal variation', () => {
        const { data } = surface.texture.image;
        let grayscale = true;
        let opaque = true;
        let minimum = Infinity;
        let maximum = -Infinity;
        for (let i = 0; i < data.length; i += 4) {
            grayscale &&= data[i] === data[i + 1] && data[i] === data[i + 2];
            opaque &&= data[i + 3] === 255;
            minimum = Math.min(minimum, data[i]);
            maximum = Math.max(maximum, data[i]);
        }
        expect(data.every(Number.isFinite)).toBe(true);
        expect(grayscale).toBe(true);
        expect(opaque).toBe(true);
        expect(maximum - minimum).toBeGreaterThan(40);
    });

    it('retains weathered floors and broad maria without turning small craters into black holes', () => {
        const { data, width, height } = surface.texture.image;
        const sample = (u, v) => data[(Math.floor(v * height) * width + Math.floor(u * width)) * 4];
        const tychoFloor = sample(0.258, 0.310);
        const tychoRim = sample(0.258, 0.310 + 0.034 / Math.PI);
        const basaltSea = sample(0.196, 0.642);
        expect(tychoFloor / 255).toBeGreaterThanOrEqual(0.07);
        expect(tychoFloor / 255).toBeLessThan(0.20);
        expect(tychoRim - tychoFloor).toBeGreaterThan(35);
        expect(basaltSea / 255).toBeGreaterThan(0.15);
        expect(basaltSea / 255).toBeLessThan(0.29);

        let dark = 0;
        let basalt = 0;
        let highland = 0;
        for (let y = 0; y < height; y++) {
            // u=0..0.5 is the composed +Z near hemisphere.
            for (let x = 0; x < width / 2; x++) {
                const albedo = data[(y * width + x) * 4];
                if (albedo < 40) dark++;
                if (albedo < 90) basalt++;
                if (albedo >= 107 && albedo <= 166) highland++;
            }
        }
        const pixels = (width / 2) * height;
        expect(dark / pixels).toBeLessThan(0.01);
        expect(basalt / pixels).toBeGreaterThan(0.05);
        expect(basalt / pixels).toBeLessThan(0.25);
        expect(highland / pixels).toBeGreaterThan(0.65);
    });

    it('stores outward unit tangent normals within eight-bit quantization tolerance', () => {
        const { data } = surface.normalTexture.image;
        let maximumLengthError = 0;
        let minimumZ = 1;
        let maximumSlope = 0;
        let opaque = true;
        for (let i = 0; i < data.length; i += 4) {
            const x = data[i] / 127.5 - 1;
            const y = data[i + 1] / 127.5 - 1;
            const z = data[i + 2] / 127.5 - 1;
            maximumLengthError = Math.max(maximumLengthError, Math.abs(Math.hypot(x, y, z) - 1));
            minimumZ = Math.min(minimumZ, z);
            maximumSlope = Math.max(maximumSlope, Math.hypot(x, y));
            opaque &&= data[i + 3] === 255;
        }
        expect(data.every(Number.isFinite)).toBe(true);
        expect(maximumLengthError).toBeLessThan(0.007);
        expect(minimumZ).toBeGreaterThan(0);
        expect(maximumSlope).toBeGreaterThan(0.05);
        expect(opaque).toBe(true);
    });

    it('gives each caller separate texture ownership even when the baked bytes are shared', () => {
        const first = createLunarSurface(THREE, SIZE);
        const second = createLunarSurface(THREE, SIZE);
        const firstAlbedoDisposed = vi.fn();
        const firstNormalDisposed = vi.fn();
        const secondAlbedoDisposed = vi.fn();
        const secondNormalDisposed = vi.fn();
        first.texture.addEventListener('dispose', firstAlbedoDisposed);
        first.normalTexture.addEventListener('dispose', firstNormalDisposed);
        second.texture.addEventListener('dispose', secondAlbedoDisposed);
        second.normalTexture.addEventListener('dispose', secondNormalDisposed);

        expect(first.texture).not.toBe(second.texture);
        expect(first.normalTexture).not.toBe(second.normalTexture);
        const secondBeforeDispose = fingerprint(second);
        first.dispose();
        expect(firstAlbedoDisposed).toHaveBeenCalledOnce();
        expect(firstNormalDisposed).toHaveBeenCalledOnce();
        expect(secondAlbedoDisposed).not.toHaveBeenCalled();
        expect(secondNormalDisposed).not.toHaveBeenCalled();
        expect(fingerprint(second)).toBe(secondBeforeDispose);

        second.dispose();
        expect(secondAlbedoDisposed).toHaveBeenCalledOnce();
        expect(secondNormalDisposed).toHaveBeenCalledOnce();
    });
});

describe('Blood Moon authored lunar surface', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    async function loaderHarness() {
        vi.resetModules();
        const { createAuthoredLunarSurface } = await import('../../src/playground/effects/blood-moon-surface.js');
        let resolveImage;
        let rejectImage;
        const load = vi.fn((url, resolve, progress, reject) => {
            resolveImage = resolve; rejectImage = reject;
        });
        const three = {
            ...THREE,
            ImageLoader: class { load(...args) { return load(...args); } },
        };
        const createElement = vi.fn(() => {
            const canvas = { width: 0, height: 0 };
            canvas.getContext = () => ({
                drawImage: vi.fn(),
                getImageData: () => {
                    const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
                    for (let y = 0; y < canvas.height; y++) {
                        for (let x = 0; x < canvas.width; x++) {
                            const pixel = (y * canvas.width + x) * 4;
                            const shade = 40 + y + (x % 8);
                            data[pixel] = shade; data[pixel + 1] = shade; data[pixel + 2] = shade;
                            data[pixel + 3] = 255;
                        }
                    }
                    return { data };
                },
            });
            return canvas;
        });
        vi.stubGlobal('document', { createElement });
        return {
            create: (size = 128) => createAuthoredLunarSurface(three, size),
            load,
            createElement,
            succeed: () => resolveImage({ width: 2048, height: 1024 }),
            fail: () => rejectImage(new Error('Missing lunar image')),
        };
    }

    it('loads once, preserves photographic tones and flips north to v=1 with gentle matching normals', async () => {
        const harness = await loaderHarness();
        const first = harness.create();
        const second = harness.create();
        try {
            expect(first.texture.image.width).toBe(1);
            expect(first.normalTexture.image.width).toBe(1);
            expect(harness.load).toHaveBeenCalledOnce();
            expect(harness.load.mock.calls[0][0]).toBe('./textures/2k_moon.jpg');
            harness.succeed();
            await Promise.all([first.ready, second.ready]);
            expect(first.source).toBe('authored');
            expect(harness.createElement).toHaveBeenCalledOnce();
            expect(first.texture).not.toBe(second.texture);
            expect(first.texture.image.data).toBe(second.texture.image.data);
            expect(first.normalTexture.image.data).toBe(second.normalTexture.image.data);
            const { data, width, height } = first.texture.image;
            expect(width).toBe(128);
            expect(height).toBe(64);
            expect(data[0]).toBe(103);
            expect(data[((height - 1) * width) * 4]).toBe(40);
            expect(data[4]).toBe(104);
            expect(first.texture.flipY).toBe(false);
            expect(first.texture.colorSpace).toBe(THREE.NoColorSpace);
            const normal = first.normalTexture.image.data;
            const pixel = (width + 4) * 4;
            expect(normal[pixel]).toBeLessThan(128);
            expect(normal[pixel + 1]).toBeGreaterThan(128);
            expect(normal[pixel + 2]).toBeGreaterThanOrEqual(254);
        } finally { first.dispose(); second.dispose(); }
    });

    it('uses the cached procedural atlas only after image loading fails', async () => {
        const harness = await loaderHarness();
        const surface = harness.create();
        try {
            harness.fail();
            await surface.ready;
            expect(surface.source).toBe('procedural-fallback');
            expect(surface.texture.image.width).toBe(128);
            expect(surface.normalTexture.image.height).toBe(64);
            expect(harness.createElement).not.toHaveBeenCalled();
            const cached = harness.create();
            try {
                await cached.ready;
                expect(harness.load).toHaveBeenCalledOnce();
                expect(cached.texture.image.data).toBe(surface.texture.image.data);
            } finally { cached.dispose(); }
        } finally { surface.dispose(); }
    });

    it('disposes each texture once and prevents uploads when disposed before the image arrives', async () => {
        const harness = await loaderHarness();
        const surface = harness.create();
        const albedo = surface.texture.image;
        const normals = surface.normalTexture.image;
        const { version } = surface.texture;
        const onAlbedoDispose = vi.fn();
        const onNormalDispose = vi.fn();
        surface.texture.addEventListener('dispose', onAlbedoDispose);
        surface.normalTexture.addEventListener('dispose', onNormalDispose);
        surface.dispose(); surface.dispose();
        harness.succeed();
        await surface.ready;
        expect(onAlbedoDispose).toHaveBeenCalledOnce();
        expect(onNormalDispose).toHaveBeenCalledOnce();
        expect(surface.texture.image).toBe(albedo);
        expect(surface.normalTexture.image).toBe(normals);
        expect(surface.texture.version).toBe(version);
    });
});
