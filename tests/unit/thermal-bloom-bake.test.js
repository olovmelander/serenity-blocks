/**
 * Thermal Bloom — the CPU bakes: deterministic, tileable, mip-chained, and quick enough to run
 * inside createScene. Relations, not tuning numbers.
 */
import { describe, expect, it } from 'vitest';
import {
    bakeBasinFan, bakeCellular, bakeNoise, bakeRamp, mipChain,
} from '../../src/themes/thermal-bloom/thermal-bloom-bake.js';
import { RAMP_WIDTH, SEASONS, rampAt } from '../../src/themes/thermal-bloom/thermal-bloom-core.js';

/** Mean absolute difference between an image's first and last column and row (wrapping). */
function seamError(data, size, channel) {
    let edge = 0;
    let inner = 0;
    for (let i = 0; i < size; i++) {
        const left = data[(i * size) * 4 + channel];
        const right = data[(i * size + size - 1) * 4 + channel];
        const top = data[i * 4 + channel];
        const bottom = data[((size - 1) * size + i) * 4 + channel];
        edge += Math.abs(left - right) + Math.abs(top - bottom);
        const a = data[(i * size + size / 2) * 4 + channel];
        const b = data[(i * size + size / 2 + 1) * 4 + channel];
        inner += 2 * Math.abs(a - b);
    }
    return { edge: edge / (2 * size), inner: inner / (2 * size) };
}

describe('Thermal Bloom bakes', () => {
    it('bakes a tileable noise atlas: every channel wraps as smoothly as it varies inside', () => {
        const t0 = performance.now();
        const n = bakeNoise(128, 7);
        const ms = performance.now() - t0;
        expect(n.data).toHaveLength(128 * 128 * 4);
        for (let c = 0; c < 4; c++) {
            const { edge, inner } = seamError(n.data, 128, c);
            expect(edge, `channel ${c}`).toBeLessThan(inner * 3 + 6);
        }
        // Stretched to the full range, so thresholds mean the same at every seed.
        for (let c = 0; c < 4; c++) {
            let lo = 255;
            let hi = 0;
            for (let i = c; i < n.data.length; i += 4) {
                lo = Math.min(lo, n.data[i]);
                hi = Math.max(hi, n.data[i]);
            }
            expect(lo).toBeLessThanOrEqual(2);
            expect(hi).toBeGreaterThanOrEqual(253);
        }
        expect(ms).toBeLessThan(2000);
    });

    it('is deterministic by seed', () => {
        expect(bakeNoise(64, 3).data).toEqual(bakeNoise(64, 3).data);
        expect(bakeNoise(64, 3).data).not.toEqual(bakeNoise(64, 4).data);
        expect(bakeCellular(64, 8, 1).data).toEqual(bakeCellular(64, 8, 1).data);
    });

    it('chains mips down to one texel, each a box filter of the one above', () => {
        const n = bakeNoise(64, 5);
        expect(n.mips.map((m) => m.width)).toEqual([64, 32, 16, 8, 4, 2, 1]);
        const chain = mipChain(new Uint8Array(4 * 4 * 4).fill(200), 4);
        expect(chain.at(-1).data[0]).toBe(200);
    });

    it('bakes a tileable cellular tile whose crackle lines are thin', () => {
        const c = bakeCellular(128, 12, 9);
        const { edge, inner } = seamError(c.data, 128, 0);
        expect(edge).toBeLessThan(inner * 3 + 12);
        // Most texels sit away from an edge; a thin share lies on the lines.
        let onLine = 0;
        for (let i = 0; i < c.data.length; i += 4) if (c.data[i] < 0.07 * 255) onLine += 1;
        const share = onLine / (128 * 128);
        expect(share).toBeGreaterThan(0.01);
        expect(share).toBeLessThan(0.25);
    });

    it('bakes the temperature ramp: a row a season, squared back to the core ramp', () => {
        const r = bakeRamp();
        expect(r.width).toBe(RAMP_WIDTH);
        expect(r.height).toBe(SEASONS.length);
        const rgb = [0, 0, 0];
        for (let s = 0; s < SEASONS.length; s++) {
            for (const i of [0, 64, 180, RAMP_WIDTH - 1]) {
                rampAt(s, i / (RAMP_WIDTH - 1), rgb);
                const o = (s * RAMP_WIDTH + i) * 4;
                for (let ch = 0; ch < 3; ch++) expect((r.data[o + ch] / 255) ** 2).toBeCloseTo(rgb[ch], 1);
                expect(r.data[o + 3]).toBe(255);
            }
        }
    });

    it('builds the basin fan: dense near the pool, reaching the far rim, flat water inside the pool', () => {
        const fan = bakeBasinFan(32, 48, { extent: 3600, poolRadius: 52 });
        expect(fan.vertexCount).toBe(1 + 32 * 48);
        expect(fan.indices.length % 3).toBe(0);
        let maxR = 0;
        let maxY = 0;
        for (let i = 0; i < fan.vertexCount; i++) {
            const x = fan.positions[i * 3];
            const y = fan.positions[i * 3 + 1];
            const z = fan.positions[i * 3 + 2];
            const r = Math.hypot(x, z);
            maxR = Math.max(maxR, r);
            maxY = Math.max(maxY, y);
            if (r < 52) expect(y).toBe(0);
        }
        expect(maxR).toBeCloseTo(3600, 0);
        expect(maxY).toBeGreaterThan(0);
        expect(maxY).toBeLessThan(3);
        // Rings are denser near the centre than at the edge.
        const ringR = (i) => Math.hypot(fan.positions[(1 + i * 48) * 3], fan.positions[(1 + i * 48) * 3 + 2]);
        expect(ringR(1) - ringR(0)).toBeLessThan(ringR(31) - ringR(30));
        // Every triangle faces up.
        for (let t = 0; t < fan.indices.length; t += 3 * 97) {
            const [a, b, c] = [fan.indices[t], fan.indices[t + 1], fan.indices[t + 2]].map((k) => [
                fan.positions[k * 3], fan.positions[k * 3 + 1], fan.positions[k * 3 + 2]]);
            const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            const ny = e1[2] * e2[0] - e1[0] * e2[2];
            expect(ny).toBeGreaterThan(0);
        }
    });
});
