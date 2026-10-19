/**
 * The Earth Core noise bake went table-driven (2026-10-19): ~210 ms of closures on the main thread
 * at the first Odyssey entry. The values must not move by a bit — the lava field's thresholds are
 * tuned on them — so the old per-texel loop is kept here as the reference.
 */
import { describe, it, expect } from 'vitest';
import { bakeTileableNoise3DData, buildTileableNoise3D } from '../../src/rendering/odyssey/chapter-environments/shared/odyssey-baked-noise.js';

const GRADS = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** The pre-2026-10-19 loop, verbatim apart from the texture wrapper. */
function referenceBake(res, grid, seed) {
    const hash = (x, y, z, s) => {
        const xi = ((x % grid) + grid) % grid;
        const yi = ((y % grid) + grid) % grid;
        const zi = ((z % grid) + grid) % grid;
        let h = (xi * 374761393 + yi * 668265263 + zi * 2147483647 + s * 40503);
        h = (h ^ (h >>> 13)) * 1274126177;
        return ((h ^ (h >>> 16)) >>> 0) % 12;
    };
    const dotg = (gi, dx, dy, dz) => GRADS[gi][0] * dx + GRADS[gi][1] * dy + GRADS[gi][2] * dz;
    const perlin = (x, y, z, s) => {
        const X = Math.floor(x); const Y = Math.floor(y); const Z = Math.floor(z);
        const fx = x - X; const fy = y - Y; const fz = z - Z;
        const u = fade(fx); const v = fade(fy); const w = fade(fz);
        const g = (ox, oy, oz) => dotg(hash(X + ox, Y + oy, Z + oz, s), fx - ox, fy - oy, fz - oz);
        const x00 = lerp(g(0, 0, 0), g(1, 0, 0), u);
        const x10 = lerp(g(0, 1, 0), g(1, 1, 0), u);
        const x01 = lerp(g(0, 0, 1), g(1, 0, 1), u);
        const x11 = lerp(g(0, 1, 1), g(1, 1, 1), u);
        return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
    };
    const data = new Float32Array(res * res * res);
    let off = 0;
    for (let z = 0; z < res; z += 1) {
        for (let y = 0; y < res; y += 1) {
            for (let x = 0; x < res; x += 1) {
                data[off] = perlin((x / res) * grid, (y / res) * grid, (z / res) * grid, seed) * 0.5 + 0.5;
                off += 1;
            }
        }
    }
    return data;
}

const sameBits = (a, b) => {
    const ua = new Uint32Array(a.buffer); const ub = new Uint32Array(b.buffer);
    if (ua.length !== ub.length) return false;
    for (let i = 0; i < ua.length; i += 1) if (ua[i] !== ub[i]) return false;
    return true;
};

describe('odyssey baked noise', () => {
    it('is bit-identical to the per-texel reference on small lattices', () => {
        for (const [res, grid, seed] of [[8, 3, 7], [16, 4, 1337], [24, 5, 99]]) {
            expect(sameBits(bakeTileableNoise3DData(res, grid, seed), referenceBake(res, grid, seed))).toBe(true);
        }
    });

    it('is bit-identical at the shipped size (96^3, grid 20, seed 1337)', () => {
        expect(sameBits(bakeTileableNoise3DData(96, 20, 1337), referenceBake(96, 20, 1337))).toBe(true);
    });

    it('still builds the same texture shape', () => {
        const tex = buildTileableNoise3D(8, 3, 10, 7);
        expect(tex.image.width).toBe(8);
        expect(tex.image.depth).toBe(8);
        expect(tex.userData.gridPeriodUnits).toBe(10);
    });
});
