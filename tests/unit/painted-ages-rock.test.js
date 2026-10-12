import { describe, expect, it } from 'vitest';
import { DataUtils } from 'three/webgpu';
import { bakeRockRelief, rockNoise } from '../../src/themes/painted-ages/painted-ages-rock.js';

describe('Painted Ages rock surface relief', () => {
    it('bakes analytic gradients that agree with centered finite differences', () => {
        const epsilon = 0.00001;
        for (const [x, y] of [[0.17, 0.51], [2.63, 4.92], [-0.26, 8.74], [7.99, 3.5]]) {
            const [, dx, dy] = rockNoise(x, y, 8);
            const numericX = (rockNoise(x + epsilon, y, 8)[0] - rockNoise(x - epsilon, y, 8)[0]) / (2 * epsilon);
            const numericY = (rockNoise(x, y + epsilon, 8)[0] - rockNoise(x, y - epsilon, 8)[0]) / (2 * epsilon);
            expect(dx).toBeCloseTo(numericX, 6);
            expect(dy).toBeCloseTo(numericY, 6);
        }
    });

    it('tiles values and slopes together, including negative world coordinates', () => {
        for (const [x, y] of [[0, 0.75], [-0.001, 7.51], [4.17, -6.42]]) {
            const sample = rockNoise(x, y, 8);
            for (const [a, b] of [[x + 8, y], [x, y - 8]]) {
                rockNoise(a, b, 8).forEach((value, i) => expect(value).toBeCloseTo(sample[i], 10));
            }
        }
    });

    it('has bounded deterministic half-float data and varied surface roughness', () => {
        const data = bakeRockRelief(32);
        expect(data).toEqual(bakeRockRelief(32));
        expect(data.byteLength).toBe(32 * 32 * 4 * 2);
        const roughness = [];
        for (let i = 0; i < data.length; i++) {
            const value = DataUtils.fromHalfFloat(data[i]);
            expect(Number.isFinite(value)).toBe(true);
            if (i % 4 === 3) roughness.push(value);
        }
        expect(Math.min(...roughness)).toBeGreaterThanOrEqual(0.19);
        expect(Math.max(...roughness)).toBeLessThanOrEqual(0.96);
        expect(Math.max(...roughness) - Math.min(...roughness)).toBeGreaterThan(0.1);
    });
});
