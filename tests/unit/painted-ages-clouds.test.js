/** CPU cloud fields must filter smoothly and light the same shape their density describes. */
import {
    afterEach, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { createCloudNoise } from '../../src/themes/painted-ages/painted-ages-clouds.js';

const textures = [];
const cloud = (size) => {
    const texture = createCloudNoise(size);
    textures.push(texture);
    return texture;
};

afterEach(() => {
    textures.forEach((texture) => texture.dispose());
    textures.length = 0;
});

/** Compare the encoded slope with an independent finite difference of the density. */
function gradientFit(numerical, encoded) {
    const count = numerical.length;
    const meanA = numerical.reduce((sum, value) => sum + value, 0) / count;
    const meanB = encoded.reduce((sum, value) => sum + value, 0) / count;
    let covariance = 0;
    let varianceA = 0;
    let varianceB = 0;
    let squaredError = 0;
    for (let i = 0; i < count; i += 1) {
        const a = numerical[i] - meanA;
        const b = encoded[i] - meanB;
        covariance += a * b;
        varianceA += a * a;
        varianceB += b * b;
        squaredError += (numerical[i] - encoded[i]) ** 2;
    }
    return {
        correlation: covariance / Math.sqrt(varianceA * varianceB),
        slope: covariance / varianceA,
        rms: Math.sqrt(squaredError / count),
    };
}

describe('Painted Ages packed cloud field', () => {
    it('uses a deterministic RGBA8 linear-data texture with repeat wrapping', () => {
        const a = cloud();
        const b = cloud();
        expect(a.isDataTexture).toBe(true);
        expect(a.image.width).toBe(128);
        expect(a.image.height).toBe(128);
        expect(a.image.data).toBeInstanceOf(Uint8Array);
        expect(a.image.data).toHaveLength(128 * 128 * 4);
        expect(a.image.data).toEqual(b.image.data);
        expect(a.image.data).not.toBe(b.image.data);
        expect(a.format).toBe(THREE.RGBAFormat);
        expect(a.type).toBe(THREE.UnsignedByteType);
        expect(a.colorSpace).toBe(THREE.NoColorSpace);
        expect(a.wrapS).toBe(THREE.RepeatWrapping);
        expect(a.wrapT).toBe(THREE.RepeatWrapping);
        expect(a.magFilter).toBe(THREE.LinearFilter);
        expect(a.minFilter).toBe(THREE.LinearMipmapLinearFilter);
        expect(a.generateMipmaps).toBe(false);
    });

    it.each([64, 128])('supplies every CPU mip through 1×1 for a %i² field', (size) => {
        const texture = cloud(size);
        expect(texture.image.width).toBe(size);
        expect(texture.image.height).toBe(size);
        expect(texture.mipmaps).toHaveLength(Math.log2(size) + 1);
        expect(texture.mipmaps[0].data).toEqual(texture.image.data);
        texture.mipmaps.forEach((mip, level) => {
            const width = Math.max(1, size >> level);
            expect(mip.width, `mip ${level}`).toBe(width);
            expect(mip.height, `mip ${level}`).toBe(width);
            expect(mip.data, `mip ${level}`).toBeInstanceOf(Uint8Array);
            expect(mip.data, `mip ${level}`).toHaveLength(width * width * 4);
            expect(mip.data.every(Number.isFinite), `mip ${level}`).toBe(true);
        });
        // Averaging must preserve the density and erosion fields rather than erase them.
        const last = texture.mipmaps.at(-1).data;
        for (const channel of [0, 3]) {
            let sum = 0;
            for (let i = channel; i < texture.image.data.length; i += 4) sum += texture.image.data[i];
            const mean = sum / (size * size);
            expect(Math.abs(last[channel] - mean)).toBeLessThanOrEqual(texture.mipmaps.length);
        }
    });

    it('provides distinct, nonconstant density and finer erosion channels', () => {
        const { data } = cloud().image;
        const density = [];
        const erosion = [];
        for (let i = 0; i < data.length; i += 4) {
            density.push(data[i]);
            erosion.push(data[i + 3]);
        }
        expect(new Set(density).size).toBeGreaterThan(16);
        expect(new Set(erosion).size).toBeGreaterThan(16);
        expect(erosion).not.toEqual(density);
    });

    it('packs periodic density derivatives in UV×4 coordinates, including the seams', () => {
        const { data, width: size } = cloud().image;
        const wrap = (value) => ((value % size) + size) % size;
        const density = (x, y) => data[(wrap(y) * size + wrap(x)) * 4] / 255;
        const step = 4 / size;
        for (const axis of [0, 1]) {
            const numerical = [];
            const encoded = [];
            const seamErrors = [];
            for (let y = 0; y < size; y += 1) {
                for (let x = 0; x < size; x += 1) {
                    const read = (offset) => density(x + (axis === 0 ? offset : 0), y + (axis === 1 ? offset : 0));
                    const difference = (-read(2) + 8 * read(1) - 8 * read(-1) + read(-2)) / (12 * step);
                    const gradient = ((data[(y * size + x) * 4 + axis + 1] / 255) * 2 - 1) * 4;
                    numerical.push(difference);
                    encoded.push(gradient);
                    const coordinate = axis === 0 ? x : y;
                    if (coordinate < 2 || coordinate >= size - 2) seamErrors.push((difference - gradient) ** 2);
                }
            }
            const fit = gradientFit(numerical, encoded);
            // Differencing 8-bit density magnifies its quantization; exact byte agreement
            // would reject a correct analytic gradient. Correlation and gain catch swapped
            // channels, reversed signs and wrong coordinate scales independently of that noise.
            expect(fit.correlation, `axis ${axis}`).toBeGreaterThan(0.98);
            expect(fit.slope, `axis ${axis}`).toBeGreaterThan(0.94);
            expect(fit.slope, `axis ${axis}`).toBeLessThan(1.06);
            expect(fit.rms, `axis ${axis}`).toBeLessThan(0.075);
            const seamRms = Math.sqrt(seamErrors.reduce((sum, value) => sum + value, 0) / seamErrors.length);
            expect(seamRms, `periodic seam, axis ${axis}`).toBeLessThan(0.075);
        }
    });
});
