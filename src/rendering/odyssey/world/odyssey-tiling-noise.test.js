import { describe, expect, it } from 'vitest';
import { createTilingValueNoise } from './odyssey-tiling-noise.js';

/**
 * The invariant that the world's whole detail bake rests on, and that it silently violated
 * for the deck's entire life: the noise must be PERIODIC in the texture resolution, because
 * the texture is sampled with RepeatWrapping and a step at the tile boundary is a straight
 * line drawn across the sky.
 *
 * These are not style checks. The pre-fix sampler failed the first case below by 0.2-0.76,
 * against an interior texel step of 0.005 — see odyssey-tiling-noise.js for the measurement
 * and the capture it explains.
 */
describe('odyssey tiling value noise', () => {
    const RES = 256;
    // Every frequency the world's bakes actually ask for.
    const FREQS = [1 / 32, 1 / 26, 1 / 11];

    it('is periodic in the texture resolution on both axes', () => {
        const vn = createTilingValueNoise(RES);
        FREQS.forEach((freq) => {
            for (let k = 0; k < RES; k += 1) {
                expect(vn(k, 7, freq)).toBeCloseTo(vn(k + RES, 7, freq), 12);
                expect(vn(11, k, freq)).toBeCloseTo(vn(11, k + RES, freq), 12);
            }
        });
    });

    it('has no step at the wrap boundary larger than its own interior steps', () => {
        const vn = createTilingValueNoise(RES);
        FREQS.forEach((freq) => {
            let interior = 0;
            for (let i = 0; i < RES - 1; i += 1) interior += Math.abs(vn(i, 3, freq) - vn(i + 1, 3, freq));
            interior /= RES - 1;
            // AGAINST THE WRAPPED NEIGHBOUR, NOT THE CONTINUATION. Comparing texel RES-1 to
            // texel RES is just another interior step of an infinite field and the broken
            // sampler sailed through it (checked: 0.1-1.2x interior). What the GPU actually
            // does with RepeatWrapping is put texel RES-1 next to texel 0, and THAT is the
            // pair that stepped 48x on the shipped bake.
            let seamX = 0;
            let seamY = 0;
            for (let k = 0; k < RES; k += 1) {
                seamX += Math.abs(vn(RES - 1, k, freq) - vn(0, k, freq));
                seamY += Math.abs(vn(k, RES - 1, freq) - vn(k, 0, freq));
            }
            // A tiling lattice makes the wrap an ordinary interior step. The pre-fix sampler
            // averaged 0.20-0.27 here, roughly 50x its interior step.
            expect(seamX / RES).toBeLessThan(interior * 3);
            expect(seamY / RES).toBeLessThan(interior * 3);
        });
    });

    it('still produces noise — not a constant, and inside [0, 1)', () => {
        const vn = createTilingValueNoise(RES);
        const values = [];
        for (let j = 0; j < RES; j += 4) for (let i = 0; i < RES; i += 4) values.push(vn(i, j, 1 / 26));
        const min = Math.min(...values);
        const max = Math.max(...values);
        expect(min).toBeGreaterThanOrEqual(0);
        expect(max).toBeLessThan(1);
        expect(max - min).toBeGreaterThan(0.5);
    });

    it('decorrelates its octaves at the tile origin, where both read cell (0, 0)', () => {
        const vn = createTilingValueNoise(RES);
        expect(vn(0, 0, 1 / 32)).not.toBeCloseTo(vn(0, 0, 1 / 26), 6);
    });
});
